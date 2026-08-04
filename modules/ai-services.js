((global) => {
  "use strict";

  const CHAT_MODEL = "gemini-2.5-flash";
  const RISK_MODEL = "gemini-2.5-flash";
  const GEMINI_CHAT_PATH = "/gemini/chat";
  const GEMINI_RISK_PATH = "/gemini/player-risk";
  const MAX_HISTORY_MESSAGES = 4;
  const MAX_HISTORY_CHARS = 1200;
  const MAX_SELECTED_MATCHES = 3;
  const MAX_OVERVIEW_MATCHES = 80;
  const MAX_REQUEST_BYTES = 28000;
  const REQUEST_TIMEOUT_MS = 90000;
  const RISK_SCAN_DELAY_MS = 900;
  const RISK_RESOLVED_CACHE_HOURS = 6;
  const RISK_LOOKBACK_DAYS = 90;

  const DEFAULT_SYSTEM_PROMPT =
    "你是一般用途的 Gemini 助理，同時熟悉 TennisRatio 網球賽事分析。全程使用繁體中文（台灣用語），回答清楚、精確、可覆盤。" +
    "你可以回答一般問題，也可以使用 Google Search 查詢即時外網資訊。凡涉及近期新聞、球員傷病、退賽、賽程、比賽結果或其他可能變動的資訊，優先使用搜尋並列出來源。" +
    "當問題涉及 TennisRatio 時，系統提供的 Pinnacle 與 ratio_analysis.json 是唯一主要資料，不得捏造賠率、勝率、評級、D值、五項比較或球員數據。" +
    "外網消息是獨立風險因子，不得取代 Pinnacle 賠率，也不得描述成必然賽果。";



  function unique(values) {
    return [...new Set(values)];
  }

  function itemNumber(value) {
    const number = Number.parseInt(String(value ?? "").trim(), 10);
    return Number.isFinite(number) ? number : null;
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function pctText(value, digits = 2) {
    const number = finiteNumber(value);
    if (number === null) return "—";
    const percentage = Math.abs(number) <= 1.5
      ? number * 100
      : number;
    return `${percentage.toFixed(digits)}%`;
  }

  function oddsText(value) {
    const number = finiteNumber(value);
    return number === null ? "—" : number.toFixed(3);
  }

  function explicitItemMentions(text) {
    const input = String(text || "");
    const patterns = [
      /(?:項次|場次|編號)\s*[#：:]?\s*(\d{1,4})/giu,
      /第\s*(\d{1,4})\s*場/giu,
      /item\s*[#：:]?\s*(\d{1,4})/giu
    ];
    const found = [];
    for (const pattern of patterns) {
      for (const match of input.matchAll(pattern)) {
        found.push(Number.parseInt(match[1], 10));
      }
    }
    return unique(found.filter(Number.isFinite));
  }

  function fullNameMentions(text, rows) {
    const folded = String(text || "").toLocaleLowerCase("en");
    const found = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const item = itemNumber(row?.項次);
      if (item === null) continue;
      const names = [row?.主場, row?.客場]
        .map(value => String(value || "").trim())
        .filter(Boolean);
      if (names.some(name => folded.includes(name.toLocaleLowerCase("en")))) {
        found.push(item);
      }
    }
    return unique(found);
  }

  function selectedRowsForQuestion(question, rows, history = []) {
    let selectedItems = unique([
      ...explicitItemMentions(question),
      ...fullNameMentions(question, rows)
    ]);

    if (!selectedItems.length) {
      for (const item of history.slice(-MAX_HISTORY_MESSAGES).reverse()) {
        const text = String(item?.text || item?.content || "");
        const references = unique([
          ...explicitItemMentions(text),
          ...fullNameMentions(text, rows)
        ]);
        if (references.length) {
          selectedItems = references;
          break;
        }
      }
    }

    const selectedSet = new Set(selectedItems.slice(0, MAX_SELECTED_MATCHES));
    return (Array.isArray(rows) ? rows : [])
      .filter(row => selectedSet.has(itemNumber(row?.項次)));
  }

  function ratingCountSummary(rows) {
    const all = {};
    const active = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      const rating = String(row?.評級 || "未分類").trim() || "未分類";
      all[rating] = (all[rating] || 0) + 1;
      if (!Boolean(row?.已過期)) {
        active[rating] = (active[rating] || 0) + 1;
      }
    }
    return { 全部場次: all, 未過期場次: active };
  }

  function ratingAggregateQuestion(question) {
    const text = String(question || "").replace(/\s+/g, "").toUpperCase();
    return /(幾場|多少場|幾個|多少個|數量|分布|統計|目前有)/u.test(text) &&
      /(A級|B級|C級|淘汰|冷門方|過期|資料不足|場地待補|層級待補|評級)/u.test(text);
  }

  function rankingQuestion(question) {
    const text = String(question || "");
    if (/(EV最高|最高EV|EV排行|EV排名)/i.test(text)) return "ev";
    if (/(評級勝率最高|最高評級勝率|勝率排行)/i.test(text)) return "probability";
    if (/(賠率最低|最低賠率)/i.test(text)) return "odds";
    return null;
  }

  function externalRiskQuestion(question) {
    return /(傷病|受傷|退賽|傷退|疾病|生病|不利|風險|疲勞|短休|長時間比賽|醫療暫停|新聞|消息|狀態|injur|withdraw|retire|illness|fatigue|medical timeout)/i.test(
      String(question || "")
    );
  }

  function selectedDataQuestion(question) {
    return /(評級|勝率|EV|熱門方|賠率|對陣|主場|客場|時間|聯賽|層級|輪次|場地|排名|D值|五項)/i.test(
      String(question || "")
    );
  }

  function directRatingAnswer(rows) {
    const counts = ratingCountSummary(rows);
    const ordered = ["A", "B", "C", "淘汰", "冷門方", "過期", "資料不足", "場地待補", "層級待補"];
    const activeText = ordered
      .filter(key => counts.未過期場次[key])
      .map(key => `${key} ${counts.未過期場次[key]} 場`)
      .join("｜") || "目前沒有未過期場次";
    const allText = ordered
      .filter(key => counts.全部場次[key])
      .map(key => `${key} ${counts.全部場次[key]} 場`)
      .join("｜") || "沒有資料";
    return `未過期場次：${activeText}。\n全部場次：${allText}。`;
  }

  function directSelectedAnswer(row) {
    const model = row?.模型 && typeof row.模型 === "object" ? row.模型 : {};
    const info = row?.比賽資訊 && typeof row.比賽資訊 === "object" ? row.比賽資訊 : {};
    return [
      `項次${row?.項次 ?? "—"}｜${row?.主場 || "—"} vs ${row?.客場 || "—"}`,
      `${row?.日期時間 || "時間未知"}｜${info.tournament_level || row?.聯賽 || "聯賽未知"}｜${info.round_name || "輪次未知"}｜${info.surface || "場地未知"}`,
      `熱門方：${row?.熱門方 || "—"}｜賠率 ${oddsText(row?.熱門方賠率)}｜Pinnacle去水勝率 ${pctText(row?.Pinnacle去水勝率)}`,
      `評級：${row?.評級 || "—"}｜評級勝率 ${pctText(row?.評級勝率)}｜評級EV ${pctText(row?.評級EV, 2)}`,
      `D值：${finiteNumber(model?.D數據差) ?? "—"}｜五項支持 ${model?.熱門方五項較優數 ?? "—"}/${model?.五項比較數 ?? "—"}｜Main權重 ${pctText(model?.Main權重)}｜All Levels權重 ${pctText(model?.["All Levels權重"])}`
    ].join("\n");
  }

  function directRankingAnswer(rows, mode) {
    const candidates = (Array.isArray(rows) ? rows : [])
      .filter(row => !Boolean(row?.已過期))
      .map(row => ({
        row,
        value: mode === "ev"
          ? finiteNumber(row?.評級EV)
          : mode === "probability"
            ? finiteNumber(row?.評級勝率)
            : finiteNumber(row?.熱門方賠率)
      }))
      .filter(item => item.value !== null)
      .sort((a, b) => mode === "odds" ? a.value - b.value : b.value - a.value)
      .slice(0, 5);

    if (!candidates.length) return "目前沒有可排行的未過期資料。";
    return candidates.map((item, index) => {
      const row = item.row;
      const value = mode === "ev"
        ? pctText(item.value, 2)
        : mode === "probability"
          ? pctText(item.value)
          : oddsText(item.value);
      return `${index + 1}. 項次${row?.項次}｜${row?.熱門方}｜${row?.評級}｜${value}`;
    }).join("\n");
  }

  function localAnswer(question, options = {}) {
    const rows = Array.isArray(options.rows)
      ? options.rows
      : (Array.isArray(options.analysis?.matches) ? options.analysis.matches : []);

    if (ratingAggregateQuestion(question)) {
      return {
        answer: directRatingAnswer(rows),
        model: "JavaScript",
        context_mode: "local_javascript",
        selected_items: [],
        sent_match_count: 0,
        total_match_count: rows.length,
        request_bytes: 0,
        retry_count: 0,
        grounding_sources: [],
        web_search_queries: []
      };
    }

    const rankingMode = rankingQuestion(question);
    if (rankingMode) {
      return {
        answer: directRankingAnswer(rows, rankingMode),
        model: "JavaScript",
        context_mode: "local_javascript",
        selected_items: [],
        sent_match_count: 0,
        total_match_count: rows.length,
        request_bytes: 0,
        retry_count: 0,
        grounding_sources: [],
        web_search_queries: []
      };
    }

    const selected = selectedRowsForQuestion(question, rows, options.history || []);
    if (selected.length === 1 && selectedDataQuestion(question) && !externalRiskQuestion(question)) {
      return {
        answer: directSelectedAnswer(selected[0]),
        model: "JavaScript",
        context_mode: "local_javascript",
        selected_items: [selected[0]?.項次],
        sent_match_count: 1,
        total_match_count: rows.length,
        request_bytes: 0,
        retry_count: 0,
        grounding_sources: [],
        web_search_queries: []
      };
    }

    return null;
  }

  function compactOverviewRow(row) {
    const model = row?.模型 && typeof row.模型 === "object" ? row.模型 : {};
    return {
      項: row?.項次 ?? null,
      時: row?.日期時間 ?? null,
      聯: row?.聯賽 ?? null,
      主: row?.主場 ?? null,
      客: row?.客場 ?? null,
      熱: row?.熱門方 ?? null,
      賠: row?.熱門方賠率 ?? null,
      市率: row?.Pinnacle去水勝率 ?? null,
      評率: row?.評級勝率 ?? null,
      EV: row?.評級EV百分比 ?? row?.["公式B EV百分比"] ?? null,
      級: row?.評級 ?? null,
      D: model?.D數據差 ?? null,
      五: model?.熱門方五項較優數 == null && model?.五項比較數 == null
        ? null
        : `${model?.熱門方五項較優數 ?? 0}/${model?.五項比較數 ?? 0}`,
      M: model?.Main權重 ?? null,
      A: model?.["All Levels權重"] ?? null,
      期: Boolean(row?.已過期)
    };
  }

  function compactSelectedRow(row) {
    const info = row?.比賽資訊 && typeof row.比賽資訊 === "object" ? row.比賽資訊 : {};
    const model = row?.模型 && typeof row.模型 === "object" ? row.模型 : {};
    return {
      項次: row?.項次 ?? null,
      日期時間: row?.日期時間 ?? null,
      聯賽: row?.聯賽 ?? null,
      層級: info?.tournament_level ?? null,
      輪次: info?.round_name ?? null,
      場地: info?.surface ?? null,
      主場: row?.主場 ?? null,
      客場: row?.客場 ?? null,
      主場名次: row?.主場名次 ?? null,
      客場名次: row?.客場名次 ?? null,
      主場賠率: row?.主場賠率 ?? null,
      客場賠率: row?.客場賠率 ?? null,
      熱門方: row?.熱門方 ?? null,
      熱門方賠率: row?.熱門方賠率 ?? null,
      Pinnacle去水勝率: row?.Pinnacle去水勝率 ?? null,
      評級: row?.評級 ?? null,
      評級勝率: row?.評級勝率 ?? null,
      評級EV: row?.評級EV ?? null,
      判定原因: row?.判定原因 ?? null,
      D值: model?.D數據差 ?? null,
      五項支持: model?.熱門方五項較優數 ?? null,
      五項比較數: model?.五項比較數 ?? null,
      Main權重: model?.Main權重 ?? null,
      AllLevels權重: model?.["All Levels權重"] ?? null,
      排名情境: model?.排名情境 ?? null,
      排名情境說明: model?.排名情境說明 ?? null,
      已過期: Boolean(row?.已過期)
    };
  }

  function buildContext(question, options = {}) {
    const rows = Array.isArray(options.rows)
      ? options.rows
      : (Array.isArray(options.analysis?.matches) ? options.analysis.matches : []);
    const selected = selectedRowsForQuestion(question, rows, options.history || []);
    const base = {
      context_schema: "tennisratio-ai-context-v1",
      revision: Number(options.revision || 0),
      batch_date: options.payload?.batch_date ?? null,
      ratio_generated_at_taiwan: options.analysis?.generated_at_taiwan ?? null,
      total_match_count: rows.length
    };

    if (selected.length) {
      return {
        ...base,
        context_mode: "selected_matches_compact",
        selected_items: selected.map(row => row?.項次),
        sent_match_count: selected.length,
        selected_matches: selected.map(compactSelectedRow)
      };
    }

    const overview = rows.slice(0, MAX_OVERVIEW_MATCHES).map(compactOverviewRow);
    return {
      ...base,
      context_mode: "compact_overview",
      selected_items: [],
      sent_match_count: overview.length,
      table_rows_compact: overview,
      rating_counts: ratingCountSummary(rows),
      rows_omitted: Math.max(0, rows.length - overview.length)
    };
  }

  function normalizeRiskKeyPart(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function externalRiskMatchKey(row) {
    const date = String(row?.日期時間 || "").trim().replace(/\s+/g, "T");
    return `${date}|${normalizeRiskKeyPart(row?.主場)}|${normalizeRiskKeyPart(row?.客場)}`;
  }

  function parseTaipeiMatchTime(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
    const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
      ? normalized
      : (/T\d{2}:\d{2}:\d{2}$/.test(normalized) ? `${normalized}+08:00` : `${normalized}:00+08:00`);
    const parsed = Date.parse(zoned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isExternalRiskEligible(row, nowMs = Date.now()) {
    const rating = String(row?.評級 || "").trim();
    if (!['A', 'B'].includes(rating)) return false;
    const probability = finiteNumber(row?.評級勝率);
    if (probability === null) return false;
    const percentage = probability <= 1.5 ? probability * 100 : probability;
    if (percentage < 65) return false;
    if (row?.已過期 === true) return false;
    const matchTime = parseTaipeiMatchTime(row?.日期時間);
    if (Number.isFinite(matchTime) && nowMs > matchTime + 15 * 60 * 1000) return false;
    return Boolean(String(row?.熱門方 || "").trim());
  }

  function normalizeRiskStatus(value) {
    const status = String(value || "");
    if (status === "insufficient") return "manual_review";
    if (["format_error", "quota_429", "network_timeout", "failed", "request_413"].includes(status)) {
      return "search_incomplete";
    }
    if (status === "auth_401_403") return "system_error";
    return status;
  }

  function isRiskResolvedStatus(value) {
    return ["risk_found", "clear", "manual_review"].includes(normalizeRiskStatus(value));
  }

  function isRiskFailureStatus(value) {
    return ["search_incomplete", "system_error"].includes(normalizeRiskStatus(value));
  }

  function riskCacheHours(entry) {
    return isRiskResolvedStatus(entry?.status)
      ? (finiteNumber(entry?.cache_hours) > 0 ? Number(entry.cache_hours) : RISK_RESOLVED_CACHE_HOURS)
      : 0;
  }

  function isRiskCacheFresh(entry, row, nowMs = Date.now()) {
    if (!entry || !isRiskResolvedStatus(entry.status)) return false;
    if (String(entry.risk_pipeline_version || "") !== "gemini-search-v1") return false;
    if (String(entry.match_key || "") !== externalRiskMatchKey(row)) return false;
    if (String(entry.hot_player || "") !== String(row?.熱門方 || "")) return false;
    if (String(entry.rating || "") !== String(row?.評級 || "")) return false;
    const checkedAt = Date.parse(String(entry.checked_at || ""));
    if (!Number.isFinite(checkedAt)) return false;
    return nowMs - checkedAt <= riskCacheHours(entry) * 3600000;
  }

  function compactRiskMatch(row) {
    const model = row?.模型 && typeof row.模型 === "object" ? row.模型 : {};
    return {
      match_key: externalRiskMatchKey(row),
      item: row?.項次 ?? null,
      date_time_taipei: row?.日期時間 ?? null,
      league: row?.聯賽 ?? null,
      tournament_level: row?.比賽資訊?.tournament_level ?? null,
      round: row?.比賽資訊?.round_name ?? null,
      surface: row?.比賽資訊?.surface ?? null,
      home: row?.主場 ?? null,
      away: row?.客場 ?? null,
      hot_player: row?.熱門方 ?? null,
      hot_side: row?.熱門方位置 ?? null,
      hot_odds: row?.熱門方賠率 ?? null,
      rating: row?.評級 ?? null,
      rating_probability: row?.評級勝率 ?? null,
      rating_ev: row?.評級EV ?? null,
      d_value: model?.D數據差 ?? null,
      five_support: model?.熱門方五項較優數 ?? null,
      five_total: model?.五項比較數 ?? null
    };
  }

  function stripJsonFence(text) {
    const value = String(text || "").trim();
    const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = fenced ? fenced[1].trim() : value;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return candidate.slice(start, end + 1);
  }

  function geminiText(payload) {
    const chunks = [];
    for (const candidate of Array.isArray(payload?.candidates) ? payload.candidates : []) {
      for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
        if (typeof part?.text === "string" && part.text.trim()) chunks.push(part.text.trim());
      }
    }
    const text = chunks.join("\n").trim();
    if (text) return text;
    const reason = payload?.promptFeedback?.blockReason || payload?.candidates?.[0]?.finishReason;
    throw new Error(reason ? `Gemini 沒有產生可顯示內容：${reason}` : "Gemini 回應中沒有可顯示文字。");
  }

  function geminiGrounding(payload) {
    const sources = [];
    const queries = [];
    const seen = new Set();
    for (const candidate of Array.isArray(payload?.candidates) ? payload.candidates : []) {
      const metadata = candidate?.groundingMetadata || {};
      for (const query of Array.isArray(metadata?.webSearchQueries) ? metadata.webSearchQueries : []) {
        const value = String(query || "").trim();
        if (value && !queries.includes(value)) queries.push(value);
      }
      for (const chunk of Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : []) {
        const web = chunk?.web || {};
        const uri = String(web?.uri || "").trim();
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        sources.push({
          title: String(web?.title || uri || "Google Search 來源"),
          uri
        });
      }
    }
    return { sources: sources.slice(0, 10), queries: queries.slice(0, 10) };
  }

  function parseRiskResponse(text) {
    const jsonText = stripJsonFence(text);
    if (!jsonText) return null;
    let parsed;
    try { parsed = JSON.parse(jsonText); }
    catch { return null; }

    const allowedStatus = new Set(["risk_found", "clear", "manual_review"]);
    const allowedSeverity = new Set(["high", "medium", "none", "unknown"]);
    const allowedCategories = new Set([
      "injury", "illness", "retirement", "medical_timeout",
      "fatigue", "schedule", "form", "official_status", "other"
    ]);
    const status = allowedStatus.has(String(parsed?.status))
      ? String(parsed.status)
      : "manual_review";
    const findings = (Array.isArray(parsed?.findings) ? parsed.findings : [])
      .slice(0, 5)
      .map(item => ({
        date: String(item?.date || "").trim() || null,
        category: allowedCategories.has(String(item?.category || ""))
          ? String(item.category)
          : "other",
        title: String(item?.title || item?.fact || "近期資訊").trim().slice(0, 240),
        fact: String(item?.fact || item?.title || "").trim().slice(0, 1200),
        relevance: String(item?.relevance || "").trim().slice(0, 900),
        direction: ["negative", "neutral", "positive"].includes(String(item?.direction || ""))
          ? String(item.direction)
          : "neutral"
      }))
      .filter(item => item.title || item.fact);

    return {
      status,
      severity: allowedSeverity.has(String(parsed?.severity))
        ? String(parsed.severity)
        : (status === "clear" ? "none" : "unknown"),
      confidence: Math.max(0, Math.min(1, finiteNumber(parsed?.confidence) ?? 0)),
      summary: String(parsed?.summary || "").trim().slice(0, 1200),
      impact: String(parsed?.impact || "").trim().slice(0, 1200),
      findings,
      evidence: findings,
      notes: String(parsed?.notes || "").trim().slice(0, 1200),
      raw_summary: String(parsed?.raw_summary || "").trim().slice(0, 10000)
    };
  }

  async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    try {
      const response = await (options.fetchImpl || fetch)(url, {
        method: options.method || "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.headers || {})
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
        signal: controller.signal
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : {}; }
      catch { payload = { error: { message: text } }; }
      if (!response.ok) {
        const detail = payload?.error?.message || payload?.error || payload?.detail || text || response.statusText;
        const error = new Error(`HTTP ${response.status}：${detail}`);
        error.httpStatus = response.status;
        error.payload = payload;
        const retryAfter = Number(response.headers.get("Retry-After"));
        error.retryAfterSeconds = Number.isFinite(retryAfter) ? retryAfter : null;
        throw error;
      }
      return {
        payload,
        response,
        requestBytes: options.body === undefined
          ? 0
          : new TextEncoder().encode(JSON.stringify(options.body)).byteLength
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error("連線逾時，外部服務沒有在時間內回應。");
        timeoutError.httpStatus = null;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function riskFailure(error) {
    const status = Number(error?.httpStatus);
    if ([401, 403].includes(status)) {
      return {
        status: "system_error",
        failure_type: "auth_401_403",
        summary: "外部風險掃描已停止：Gemini API Key、Worker Token 或權限驗證失敗。",
        impact: "這是系統設定問題，不是任何一位球員的風險。",
        notes: "請檢查 Cloudflare Worker 的 GEMINI_API_KEY、UPLOAD_TOKEN 與權限設定。"
      };
    }
    if (status === 429) {
      return {
        status: "search_incomplete",
        failure_type: "quota_429",
        summary: "本場搜尋尚未完成：Gemini 目前達到使用量或頻率限制。",
        impact: "這不是球員風險，也不能視為安全。",
        notes: "下次按「分析風險」會重新嘗試。"
      };
    }
    return {
      status: "search_incomplete",
      failure_type: "network_timeout",
      summary: "本場搜尋尚未完成：Gemini 或網路暫時沒有完成回應。",
      impact: "這不是球員風險，也不能視為安全。",
      notes: "下次按「分析風險」會重新嘗試。"
    };
  }

  function readableRiskText(parsed, fallbackText = "") {
    if (String(parsed?.raw_summary || "").trim()) return String(parsed.raw_summary).trim();
    const lines = [];
    (Array.isArray(parsed?.findings) ? parsed.findings : []).forEach((item, index) => {
      lines.push(`${index + 1}. ${item?.date || "日期未明"}｜${item?.title || "近期資訊"}`);
      if (item?.fact) lines.push(String(item.fact));
      if (item?.relevance) lines.push(`與本場的可能關係：${item.relevance}`);
    });
    if (!lines.length && parsed?.summary) lines.push(String(parsed.summary));
    if (!lines.length && fallbackText) lines.push(String(fallbackText).trim());
    return lines.join("\n").slice(0, 12000);
  }

  async function scanExternalRisk(row, options = {}) {
    if (!isExternalRiskEligible(row)) {
      throw new Error("此場不符合 A／B 且評級勝率至少65%的外部風險掃描條件。");
    }
    const match = compactRiskMatch(row);
    const checkedAt = new Date();
    try {
      const response = await fetchJson(`${options.workerUrl}${GEMINI_RISK_PATH}`, {
        token: options.workerToken,
        fetchImpl: options.fetchImpl,
        body: {
          match
        }
      });
      const answer = geminiText(response.payload);
      const grounding = geminiGrounding(response.payload);
      let parsed = parseRiskResponse(answer);

      // Search information must never be hidden because of formatting.
      if (!parsed) {
        parsed = {
          status: "manual_review",
          severity: "unknown",
          confidence: 0.35,
          summary: grounding.sources.length
            ? "Gemini 已找到近期資訊，但回覆格式無法完整分類，請人工判讀。"
            : "Gemini 已提供資訊，但沒有足夠來源可確認風險。",
          impact: "下方保留本次完整回覆與可用來源，不會因格式問題而隱藏資訊。",
          findings: [],
          evidence: [],
          notes: "未列為紅色警示不等於已確認安全。",
          raw_summary: answer
        };
      }

      let status = normalizeRiskStatus(parsed.status);
      let severity = parsed.severity;
      let summary = parsed.summary;
      let impact = parsed.impact;
      let notes = parsed.notes;
      const findings = parsed.findings;

      // A clear result without actual Google Search grounding cannot be treated as confirmed clear.
      if (status === "clear" && !grounding.sources.length && !grounding.queries.length) {
        status = "manual_review";
        severity = "unknown";
        summary = "Gemini 回覆未發現明確風險，但沒有附上可核對的 Google Search 來源。";
        impact = "這場不能列為已確認安全；請閱讀模型回覆後自行判斷。";
        notes = [notes, "因缺少搜尋來源，本場顯示灰藍色 i。"].filter(Boolean).join(" ");
      }

      if (status === "risk_found" && (!findings.length || !grounding.sources.length)) {
        status = "manual_review";
        severity = "unknown";
        summary = summary || "找到可能相關資訊，但證據不足以列為紅色警示。";
        notes = [notes, "紅色警示必須同時具備具體資訊與 Google Search 來源。"].filter(Boolean).join(" ");
      }

      if (status === "clear") {
        severity = "none";
        summary = summary || "Google Search 已完成，未找到與本場直接相關的近期異常資訊。";
        impact = "";
      }
      if (status === "manual_review") {
        severity = "unknown";
        summary = summary || "找到近期資訊，請由人類自行判讀。";
        impact = impact || "目前證據不足以列為紅色風險，但資訊仍可能具有賽前參考價值。";
      }

      const cacheHours = RISK_RESOLVED_CACHE_HOURS;
      return {
        ...match,
        status,
        severity,
        confidence: parsed.confidence,
        summary,
        impact,
        findings,
        evidence: findings,
        raw_search_text: status === "clear" ? "" : readableRiskText(parsed, answer),
        notes,
        sources: grounding.sources,
        web_search_queries: grounding.queries,
        search_completed: true,
        failure_type: null,
        http_status: 200,
        retry_after_seconds: null,
        cache_hours: cacheHours,
        cache_until: new Date(checkedAt.getTime() + cacheHours * 3600000).toISOString(),
        used_cache: false,
        checked_at: checkedAt.toISOString(),
        model: response.payload?.model || RISK_MODEL,
        requested_model: RISK_MODEL,
        search_mode: "gemini_2_5_flash_google_search",
        risk_pipeline_version: "gemini-search-v1",
        retry_count: 0,
        request_bytes: response.requestBytes,
        usage: response.payload?.usageMetadata || {}
      };
    } catch (error) {
      const failure = riskFailure(error);
      return {
        ...match,
        ...failure,
        severity: "unknown",
        confidence: 0,
        findings: [],
        evidence: [],
        raw_search_text: "",
        sources: [],
        web_search_queries: [],
        search_completed: false,
        http_status: Number(error?.httpStatus) || null,
        retry_after_seconds: error?.retryAfterSeconds ?? null,
        cache_hours: 0,
        cache_until: null,
        used_cache: false,
        technical_error: error?.message || String(error),
        checked_at: checkedAt.toISOString(),
        model: RISK_MODEL,
        requested_model: RISK_MODEL,
        search_mode: "gemini_2_5_flash_google_search",
        risk_pipeline_version: "gemini-search-v1",
        retry_count: 0,
        request_bytes: 0
      };
    }
  }

  function clonePlayerRisk(entry, row, fromCache = true) {
    const match = compactRiskMatch(row);
    return {
      ...entry,
      ...match,
      used_cache: fromCache,
      reused_player_result: true,
      last_used_at: new Date().toISOString()
    };
  }

  async function scanExternalRisks(rows, options = {}) {
    const nowMs = Date.now();
    const eligibleRows = (Array.isArray(rows) ? rows : [])
      .filter(row => isExternalRiskEligible(row, nowMs))
      .sort((left, right) => {
        const order = { A: 0, B: 1 };
        const rating = (order[left?.評級] ?? 9) - (order[right?.評級] ?? 9);
        return rating || String(left?.日期時間 || "").localeCompare(String(right?.日期時間 || ""));
      });

    const existingEntries = Array.isArray(options.existingEntries) ? options.existingEntries : [];
    const existingMap = new Map(existingEntries.map(entry => [String(entry?.match_key || ""), entry]));
    const playerMap = new Map();
    for (const entry of existingEntries) {
      if (!isRiskResolvedStatus(entry?.status)) continue;
      if (String(entry?.risk_pipeline_version || "") !== "gemini-search-v1") continue;
      const checkedAt = Date.parse(String(entry?.checked_at || ""));
      if (!Number.isFinite(checkedAt) || nowMs - checkedAt > RISK_RESOLVED_CACHE_HOURS * 3600000) continue;
      playerMap.set(normalizeRiskKeyPart(entry?.hot_player), entry);
    }

    const entries = [];
    let completed = 0;
    let scanned = 0;
    let cached = 0;

    for (const row of eligibleRows) {
      const key = externalRiskMatchKey(row);
      const oldEntry = existingMap.get(key);
      let entry = null;
      let fromCache = false;

      if (isRiskCacheFresh(oldEntry, row, nowMs)) {
        entry = { ...oldEntry, used_cache: true, last_used_at: new Date().toISOString() };
        cached += 1;
        fromCache = true;
      } else {
        const playerKey = normalizeRiskKeyPart(row?.熱門方);
        const playerEntry = playerMap.get(playerKey);
        if (playerEntry && isRiskResolvedStatus(playerEntry.status)) {
          entry = clonePlayerRisk(playerEntry, row, true);
          cached += 1;
          fromCache = true;
        }
      }

      if (!entry) {
        if (typeof options.onPending === "function") {
          await options.onPending(row, { completed, total: eligibleRows.length });
        }
        entry = await scanExternalRisk(row, options);
        scanned += 1;
        if (isRiskResolvedStatus(entry.status)) {
          playerMap.set(normalizeRiskKeyPart(entry.hot_player), entry);
        }
        if (typeof options.onEntry === "function") {
          await options.onEntry(entry, {
            completed: completed + 1,
            total: eligibleRows.length,
            scanned,
            cached,
            row,
            fromCache: false
          });
        }
        const delay = Number.isFinite(Number(options.delayMs)) ? Number(options.delayMs) : RISK_SCAN_DELAY_MS;
        if (delay > 0 && completed + 1 < eligibleRows.length) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      entries.push(entry);
      completed += 1;
      if (fromCache && typeof options.onEntry === "function") {
        await options.onEntry(entry, {
          completed,
          total: eligibleRows.length,
          scanned,
          cached,
          row,
          fromCache: true
        });
      }
      if (typeof options.onProgress === "function") {
        options.onProgress({ completed, total: eligibleRows.length, scanned, cached, row, entry, fromCache });
      }
    }

    return {
      entries,
      total: eligibleRows.length,
      completed,
      scanned,
      cached,
      unresolved: entries.filter(entry => !isRiskResolvedStatus(entry.status)).length
    };
  }

  function formatRiskAnswer(entry) {
    const status = normalizeRiskStatus(entry?.status);
    const heading = status === "risk_found"
      ? "找到可能不利消息"
      : status === "manual_review"
        ? "找到相關資訊，需要人工判讀"
        : status === "clear"
          ? "搜尋完成，未找到明確異常"
          : "搜尋尚未完成";
    const lines = [
      `項次${entry?.item ?? "—"}｜${entry?.hot_player || "熱門方"}`,
      heading,
      entry?.summary || "",
      entry?.impact || ""
    ].filter(Boolean);
    const findings = Array.isArray(entry?.findings) ? entry.findings : [];
    findings.slice(0, 5).forEach((item, index) => {
      lines.push(`${index + 1}. ${item?.date || "日期未明"}｜${item?.title || "近期資訊"}`);
      if (item?.fact) lines.push(`   ${item.fact}`);
      if (item?.relevance) lines.push(`   與本場可能關係：${item.relevance}`);
    });
    if (entry?.notes) lines.push(`補充：${entry.notes}`);
    return lines.join("\n");
  }

  function questionNeedsTennisContext(question, rows) {
    const text = String(question || "");
    if (explicitItemMentions(text).length || fullNameMentions(text, rows).length) return true;
    return /(TennisRatio|網球|球員|項次|場次|評級|EV|賠率|熱門方|冷門方|Pinnacle|D值|五項|主場|客場|ATP|WTA|傷病|退賽|醫療暫停|連續多場|近期狀態)/i.test(text);
  }

  function generalChatContext(options = {}, rows = []) {
    return {
      context_schema: "tennisratio-ai-context-v1",
      revision: Number(options.revision || 0),
      batch_date: options.payload?.batch_date ?? null,
      ratio_generated_at_taiwan: options.analysis?.generated_at_taiwan ?? null,
      total_match_count: rows.length,
      context_mode: "general_web_chat",
      selected_items: [],
      sent_match_count: 0
    };
  }

  async function ask(question, options = {}) {
    const rows = Array.isArray(options.rows)
      ? options.rows
      : (Array.isArray(options.analysis?.matches) ? options.analysis.matches : []);

    const local = localAnswer(question, { ...options, rows });
    if (local) return local;

    const context = questionNeedsTennisContext(question, rows)
      ? buildContext(question, { ...options, rows })
      : generalChatContext(options, rows);

    const history = (Array.isArray(options.history) ? options.history : [])
      .slice(-MAX_HISTORY_MESSAGES)
      .map(item => ({
        role: item?.role === "model" ? "model" : "user",
        text: String(item?.text || item?.content || "").slice(0, MAX_HISTORY_CHARS)
      }));

    const systemPrompt = `${DEFAULT_SYSTEM_PROMPT}\n${String(options.customSystemPrompt || "").slice(0, 2000)}`;
    const body = {
      system_prompt: systemPrompt,
      question: String(question || "").slice(0, 3000),
      history,
      context
    };
    const bytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new Error(`Gemini 請求資料仍過大（${bytes} bytes）；請指定項次或縮小問題範圍。`);
    }

    const response = await fetchJson(`${options.workerUrl}${GEMINI_CHAT_PATH}`, {
      token: options.workerToken,
      fetchImpl: options.fetchImpl,
      body
    });
    const grounding = geminiGrounding(response.payload);

    return {
      answer: geminiText(response.payload),
      model: response.payload?.model || CHAT_MODEL,
      usage: response.payload?.usageMetadata || {},
      context_revision: Number(options.revision || 0),
      context_mode: context.context_mode,
      selected_items: context.selected_items || [],
      sent_match_count: context.sent_match_count || 0,
      total_match_count: context.total_match_count || rows.length,
      retry_count: 0,
      request_bytes: response.requestBytes,
      connection_mode: "cloudflare_worker_secret",
      grounding_requested: true,
      web_search_used: Boolean(grounding.sources.length || grounding.queries.length),
      web_search_queries: grounding.queries,
      grounding_sources: grounding.sources
    };
  }

  global.TennisRatioAI = Object.freeze({
    CHAT_MODEL,
    RISK_MODEL,
    DEFAULT_SYSTEM_PROMPT,
    buildContext,
    localAnswer,
    externalRiskMatchKey,
    isExternalRiskEligible,
    normalizeRiskStatus,
    isRiskResolvedStatus,
    isRiskFailureStatus,
    riskCacheHours,
    isRiskCacheFresh,
    compactRiskMatch,
    parseRiskResponse,
    geminiGrounding,
    scanExternalRisk,
    scanExternalRisks,
    ask
  });
})(typeof window !== "undefined" ? window : globalThis);
