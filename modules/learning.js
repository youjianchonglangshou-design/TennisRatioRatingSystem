/* ============================================================
   learning.js｜TennisRatio Learning AI 模型讀取與預測
   ------------------------------------------------------------
   原則：
   1. 這支程式是固定的 model runner，不自行修改原始碼。
   2. 永遠只讀 Cloudflare Worker 的 /learning/current-model。
   3. 正式模型由 R2 current_model.json 決定；Candidate 不會自動上線。
   4. 尚無正式模型時，只標記「學習中」，不偽造 AI 勝率。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TennisRatioLearning = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function sigmoid(value) {
    if (value >= 0) {
      const z = Math.exp(-value);
      return 1 / (1 + z);
    }
    const z = Math.exp(value);
    return z / (1 + z);
  }

  function breadthStats(row, scopeName) {
    const block = row?.["原始指標比較"]?.[scopeName];
    const stats = block?.["統計"] || {};
    return {
      hot: finite(stats?.["熱門方較優項數"]),
      cold: finite(stats?.["對手較優項數"]),
      effective: finite(stats?.["有效比較項數"])
    };
  }

  function extractFeatures(row) {
    const model = row?.["模型"] && typeof row["模型"] === "object"
      ? row["模型"] : {};
    const fiveStats = row?.["評級五項比較"]?.["統計"] || {};
    const allBreadth = breadthStats(row, "All Levels｜同場地");
    const mainBreadth = breadthStats(row, "Main Tour｜同場地");
    const mainWeight = finite(model?.["Main權重"]);
    const preferredBreadth = mainWeight !== null && mainWeight > 0.5
      ? mainBreadth : allBreadth;

    const features = {
      pinnacle_probability: finite(row?.["Pinnacle去水勝率"]),
      break_even_probability: finite(row?.["賠轉勝率"]),
      rating_probability: finite(row?.["評級勝率"] ?? row?.["公式B勝率"]),
      rating_ev: finite(row?.["評級EV"] ?? row?.["公式B EV"]),
      hot_odds: finite(row?.["熱門方賠率"]),
      d_value: finite(model?.["D數據差"]),
      rank_log_gap: finite(model?.["R排名差"]),
      rank_reliability: finite(model?.["Q排名可信度"]),
      support5: finite(fiveStats?.["熱門方較優項數"] ?? model?.["熱門方五項較優數"]),
      support5_effective: finite(fiveStats?.["有效比較項數"] ?? model?.["五項比較數"]),
      breadth15: preferredBreadth.hot,
      breadth15_effective: preferredBreadth.effective,
      breadth15_all: allBreadth.hot,
      breadth15_main: mainBreadth.hot,
      main_weight: mainWeight,
      all_weight: finite(model?.["All Levels權重"])
    };

    // 常見非線性交互項先標準化成固定 feature 名稱。
    if (features.breadth15 !== null && features.support5 !== null) {
      features.breadth15_x_support5 = features.breadth15 * features.support5;
    }
    if (features.support5 !== null && features.d_value !== null) {
      features.support5_x_d = features.support5 * features.d_value;
    }
    if (features.breadth15 !== null && features.d_value !== null) {
      features.breadth15_x_d = features.breadth15 * features.d_value;
    }
    return features;
  }

  function transformedFeature(features, key, schema = {}) {
    const raw = finite(features?.[key]);
    if (raw === null) return Number(schema?.missing ?? 0);
    const center = finite(schema?.center) ?? finite(schema?.mean) ?? 0;
    const scale = finite(schema?.scale) ?? finite(schema?.std) ?? 1;
    return scale === 0 ? raw - center : (raw - center) / scale;
  }

  function predictLogistic(model, features) {
    let score = finite(model?.bias) ?? 0;
    const schema = model?.feature_schema || {};
    for (const [key, weightValue] of Object.entries(model?.weights || {})) {
      const weight = finite(weightValue);
      if (weight === null) continue;
      score += weight * transformedFeature(features, key, schema?.[key] || {});
    }
    const probability = sigmoid(score);
    const min = finite(model?.output_clip?.min) ?? 0.01;
    const max = finite(model?.output_clip?.max) ?? 0.99;
    return clamp(probability, min, max);
  }

  function evalTreeNode(node, features) {
    if (!node || typeof node !== "object") return 0;
    if (finite(node.value) !== null && !node.feature) return Number(node.value);
    const value = finite(features?.[node.feature]);
    const missingDirection = String(node.missing || "left").toLowerCase();
    if (value === null) {
      return evalTreeNode(missingDirection === "right" ? node.right : node.left, features);
    }
    const threshold = finite(node.threshold) ?? 0;
    return evalTreeNode(value <= threshold ? node.left : node.right, features);
  }

  function predictForest(model, features) {
    let score = finite(model?.base_score) ?? 0;
    const rate = finite(model?.learning_rate) ?? 1;
    for (const tree of Array.isArray(model?.trees) ? model.trees : []) {
      score += rate * evalTreeNode(tree, features);
    }
    const probability = String(model?.link || "logit") === "identity"
      ? score : sigmoid(score);
    const min = finite(model?.output_clip?.min) ?? 0.01;
    const max = finite(model?.output_clip?.max) ?? 0.99;
    return clamp(probability, min, max);
  }

  function predict(model, features) {
    const type = String(model?.type || "").toLowerCase();
    if (["logistic", "logistic_v1", "linear_logit_v1"].includes(type)) {
      return predictLogistic(model, features);
    }
    if (["gradient_boosted_trees_v1", "forest_v1", "tree_ensemble_v1"].includes(type)) {
      return predictForest(model, features);
    }
    throw new Error(`Learning模型類型不支援：${model?.type || "unknown"}`);
  }

  async function loadCurrentModel(workerUrl) {
    const base = normalizeBaseUrl(workerUrl);
    if (!base) throw new Error("WORKER_URL 尚未設定。");
    const response = await fetch(`${base}/learning/current-model?v=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`Learning current-model HTTP ${response.status}`);
    }
    return response.json();
  }

  function judgement(probability, model) {
    const support = finite(model?.decision_thresholds?.support) ?? 0.69;
    const warning = finite(model?.decision_thresholds?.warning) ?? 0.58;
    if (probability >= support) return "支持";
    if (probability < warning) return "警示";
    return "保留";
  }

  function learningPlaceholder(manifest = {}, reason = "尚未建立正式Learning模型") {
    const settled = Number(manifest?.settled_unique_matches || 0);
    const firstTarget = Number(manifest?.next_training_at || 100);
    const progressNote = !manifest?.active_model && settled < firstTarget
      ? `目前${settled}/${firstTarget}場；達門檻後自動建立第一個Shadow模型。`
      : reason;
    return {
      狀態: "learning",
      判定: "學習中",
      熱門方勝率: null,
      模型版本: manifest?.active_version ?? null,
      已結算獨立比賽: settled,
      學習樣本快照: Number(manifest?.experience_snapshots || 0),
      下一次訓練門檻: firstTarget,
      樣本階段: String(manifest?.sample_stage || "collecting"),
      低樣本試判: false,
      說明: progressNote
    };
  }

  async function applyToAnalysis(analysis, workerUrl) {
    const output = analysis && typeof analysis === "object" ? analysis : { matches: [] };
    const rows = Array.isArray(output.matches) ? output.matches : [];
    let current;
    try {
      current = await loadCurrentModel(workerUrl);
    } catch (error) {
      current = {
        status: "learning",
        manifest: {},
        model: null,
        error: error?.message || String(error)
      };
    }

    const manifest = current?.manifest || {};
    const model = current?.model || null;
    const active = current?.status === "active" && model && typeof model === "object";

    for (const row of rows) {
      if (!active) {
        row["AI自己的想法"] = learningPlaceholder(
          manifest,
          current?.error || "Learning資料層已啟用；等待第一個正式模型。"
        );
        continue;
      }
      try {
        const features = extractFeatures(row);
        const probability = predict(model, features);
        const datasetMatches = Number(
          model?.dataset_unique_matches ?? manifest?.active_model_dataset_matches ?? 0
        );
        const sampleStage = String(
          model?.sample_stage || manifest?.sample_stage ||
          (datasetMatches >= 300 ? "established" : "low_sample")
        );
        const validation = model?.metrics?.candidate_validation || {};
        row["AI自己的想法"] = {
          狀態: "active",
          判定: judgement(probability, model),
          熱門方勝率: probability,
          模型版本: manifest?.active_version ?? model?.version ?? null,
          已結算獨立比賽: Number(manifest?.settled_unique_matches || 0),
          訓練資料獨立比賽: datasetMatches,
          學習樣本快照: Number(manifest?.experience_snapshots || 0),
          樣本階段: sampleStage,
          低樣本試判: sampleStage !== "established",
          驗證命中率: finite(validation?.accuracy),
          驗證LogLoss: finite(validation?.log_loss),
          驗證Brier: finite(validation?.brier),
          下一次訓練門檻: Number(manifest?.next_training_at || 0),
          特徵版本: model?.feature_version || "tennisratio-learning-v1",
          說明: String(model?.description || "Learning模型依歷史覆盤資料判定。")
        };
      } catch (error) {
        row["AI自己的想法"] = {
          ...learningPlaceholder(manifest, `模型執行失敗：${error?.message || String(error)}`),
          狀態: "model_error",
          判定: "模型錯誤"
        };
      }
    }

    output.learning_model = {
      status: active ? "active" : "learning",
      active_version: manifest?.active_version ?? null,
      active_model: manifest?.active_model ?? null,
      sample_stage: manifest?.sample_stage || (active ? model?.sample_stage : "collecting"),
      active_model_dataset_matches: Number(
        manifest?.active_model_dataset_matches ?? model?.dataset_unique_matches ?? 0
      ),
      settled_unique_matches: Number(manifest?.settled_unique_matches || 0),
      experience_snapshots: Number(manifest?.experience_snapshots || 0),
      next_training_at: Number(manifest?.next_training_at || 100),
      checked_at: new Date().toISOString()
    };
    return output;
  }

  return {
    finite,
    extractFeatures,
    predict,
    loadCurrentModel,
    applyToAnalysis,
    learningPlaceholder
  };
});
