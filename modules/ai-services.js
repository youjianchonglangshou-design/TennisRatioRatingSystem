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
  const RISK_SCAN_DELAY_MIN_MS = 30000;
  const RISK_SCAN_DELAY_MAX_MS = 35000;
  const RISK_MAX_ATTEMPTS = 2;
  const RETRY_UNKNOWN_429_SECONDS = 90;
  const RETRY_503_SECONDS = 30;
  const RETRY_NETWORK_SECONDS = 20;
  const RISK_RESOLVED_CACHE_HOURS = 6;
  const RISK_LOOKBACK_DAYS = 90;

  const DEFAULT_SYSTEM_PROMPT =
    "你是一般用途的 Gemini 助理，同時熟悉 TennisRatio 網球賽事分析。全程使用繁體中文（台灣用語），回答清楚、精確、可覆盤。" +
    "你可以回答一般問題，也可以使用 Google Search 查詢即時外網資訊。凡涉及近期新聞、球員傷病、退賽、賽程、比賽結果或其他可能變動的資訊，優先使用搜尋並列出來源。" +
    "當問題涉及 TennisRatio 時，系統提供的 Pinnacle 與 ratio_analysis.json 是唯一主要資料，不得捏造賠率、勝率、評級、D值、五項比較或球員數據。" +
    "外網消息是獨立風險因子，不得取代 Pinnacle 賠率，也不得描述成必然賽果。";


  // 左側問答與風險掃描共用同一條 Gemini 請求佇列。
  // 即使未來 UI 開放同時操作，同一時間仍只會送出 1 個 Gemini HTTP 請求。
  let geminiQueueTail = Promise.resolve();
  let geminiQueueTicket = 0;
  let geminiQueueDepth = 0;

  async function runWithCrossTabGeminiLock(task) {
    const locks = global?.navigator?.locks;
    if (locks && typeof locks.request === "function") {
      return locks.request(
        "tennisratio-gemini-request",
        { mode: "exclusive" },
        task
      );
    }
    return task();
  }

  function emitQueueState(callback, detail) {
    if (typeof callback !== "function") return;
    Promise.resolve(callback(detail)).catch(error => {
      console.info("Gemini 佇列狀態更新失敗。", error);
    });
  }

  function enqueueGeminiRequest(task, options = {}) {
    const ticket = ++geminiQueueTicket;
    const ahead = geminiQueueDepth;
    geminiQueueDepth += 1;
    if (ahead > 0) {
      emitQueueState(options.onQueueState, {
        state: "queued",
        ticket,
        position: ahead,
        queueDepth: geminiQueueDepth
      });
    }

    const run = async () => {
      if (typeof options.onQueueState === "function") {
        await options.onQueueState({
          state: "running",
          ticket,
          position: 0,
          queueDepth: geminiQueueDepth
        });
      }
      try {
        return await runWithCrossTabGeminiLock(task);
      } finally {
        geminiQueueDepth = Math.max(0, geminiQueueDepth - 1);
        if (typeof options.onQueueState === "function") {
          await options.onQueueState({
            state: "idle",
            ticket,
            position: 0,
            queueDepth: geminiQueueDepth
          });
        }
      }
    };
    const current = geminiQueueTail.then(run, run);
    geminiQueueTail = current.catch(() => undefined);
    return current;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function randomInteger(min, max) {
    const low = Math.ceil(Number(min) || 0);
    const high = Math.floor(Number(max) || low);
    return low + Math.floor(Math.random() * Math.max(1, high - low + 1));
  }

  async function waitWithCountdown(milliseconds, callback, context = {}) {
    const endAt = Date.now() + Math.max(0, Number(milliseconds) || 0);
    let previous = null;
    while (true) {
      const remainingMs = Math.max(0, endAt - Date.now());
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      if (remainingSeconds !== previous && typeof callback === "function") {
        await callback({ ...context, remainingSeconds, endAt });
        previous = remainingSeconds;
      }
      if (remainingMs <= 0) break;
      await sleep(Math.min(1000, remainingMs));
    }
  }



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
    if (String(entry.risk_pipeline_version || "") !== "gemini-search-safe-v2") return false;
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

  function parseRetryAfterHeader(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return Math.max(0, Math.ceil(numeric));
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
    return null;
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
        error.retryAfterSeconds = parseRetryAfterHeader(response.headers.get("Retry-After"));
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
        timeoutError.failureHint = "network_timeout";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function collectErrorStrings(value, output = [], depth = 0) {
    if (depth > 8 || value == null) return output;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output.push(String(value));
      return output;
    }
    if (Array.isArray(value)) {
      value.forEach(item => collectErrorStrings(item, output, depth + 1));
      return output;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([key, item]) => {
        output.push(String(key));
        collectErrorStrings(item, output, depth + 1);
      });
    }
    return output;
  }

  function frontendGeminiErrorDiagnostic(error) {
    const status = Number(error?.httpStatus) || null;
    const normalized = error?.payload?.tennisratio_error;
    if (normalized && typeof normalized === "object") {
      return {
        category: String(normalized.category || "unknown_error"),
        httpStatus: status,
        retryAfterSeconds: finiteNumber(normalized.retry_after_seconds) ?? error?.retryAfterSeconds ?? null,
        quotaMetric: String(normalized.quota_metric || "") || null,
        quotaId: String(normalized.quota_id || "") || null,
        quotaValue: normalized.quota_value ?? null,
        rawMessage: String(normalized.raw_message || error?.message || "")
      };
    }

    const text = collectErrorStrings(error?.payload || {}).concat([error?.message || ""]).join(" ").toLowerCase();
    let category = "unknown_error";
    if (status === 429) {
      if (/google.?search|grounding/.test(text) && /(per.?day|daily|rpd|quota.?exceeded)/.test(text)) {
        category = "quota_search_rpd";
      } else if (/(token|input.?token|output.?token)/.test(text) && /(per.?minute|tpm)/.test(text)) {
        category = "rate_limit_tpm";
      } else if (/(request|generate.?request)/.test(text) && /(per.?minute|rpm)/.test(text)) {
        category = "rate_limit_rpm";
      } else if (/(per.?day|daily|rpd|quota.?exceeded)/.test(text)) {
        category = "quota_model_rpd";
      } else {
        category = "rate_limit_unknown_429";
      }
    } else if (status === 503 || status === 500 || status === 502 || status === 504) {
      category = status === 503 ? "service_unavailable_503" : "service_unavailable_5xx";
    } else if ([401, 403].includes(status)) {
      category = /location.+not supported|unsupported.+location|region/.test(text)
        ? "location_unsupported"
        : "auth_401_403";
    } else if (status === 404) {
      category = "model_unavailable_404";
    } else if (status === 413) {
      category = "request_too_large_413";
    } else if (!status || error?.failureHint === "network_timeout") {
      category = "network_timeout";
    }
    return {
      category,
      httpStatus: status,
      retryAfterSeconds: error?.retryAfterSeconds ?? null,
      quotaMetric: null,
      quotaId: null,
      quotaValue: null,
      rawMessage: String(error?.message || "")
    };
  }

  function failureDetails(category, diagnostic) {
    const retryAfter = finiteNumber(diagnostic.retryAfterSeconds);
    const quotaLines = [
      diagnostic.quotaMetric ? `Quota metric：${diagnostic.quotaMetric}` : "",
      diagnostic.quotaId ? `Quota ID：${diagnostic.quotaId}` : "",
      diagnostic.quotaValue != null ? `Quota value：${diagnostic.quotaValue}` : ""
    ].filter(Boolean);

    const map = {
      rate_limit_rpm: {
        status: "search_incomplete",
        failure_type: "rate_limit_rpm",
        summary: "Gemini 每分鐘請求限制（RPM）",
        impact: "短時間內送出的 Gemini 請求次數過多；這不是每日額度用完，也不是球員風險。",
        notes: "系統已暫停整批掃描，等待後只會重試目前球員一次。",
        diagnostic_title: "⚠ Gemini 每分鐘請求限制（RPM）",
        diagnostic_lines: ["短時間內的請求次數超過專案目前限制。", "已完成結果會立即保存在 R2。", ...quotaLines],
        retryable: true,
        retry_wait_seconds: retryAfter ?? RETRY_UNKNOWN_429_SECONDS,
        stop_batch: false,
        quota_kind: "RPM"
      },
      rate_limit_tpm: {
        status: "search_incomplete",
        failure_type: "rate_limit_tpm",
        summary: "Gemini 每分鐘 Token 限制（TPM）",
        impact: "最近一分鐘處理的文字與搜尋內容量過高；這不是每日搜尋次數用完。",
        notes: "系統等待後會改用精簡提示詞，只重試目前球員一次。",
        diagnostic_title: "⚠ Gemini 每分鐘 Token 限制（TPM）",
        diagnostic_lines: ["最近一分鐘的 Token 處理量超過專案目前限制。", "第二次請求會使用精簡提示詞。", ...quotaLines],
        retryable: true,
        retry_wait_seconds: retryAfter ?? RETRY_UNKNOWN_429_SECONDS,
        stop_batch: false,
        quota_kind: "TPM"
      },
      quota_model_rpd: {
        status: "search_incomplete",
        failure_type: "quota_model_rpd",
        summary: "Gemini 今日模型請求額度已達上限（RPD）",
        impact: "這是每日額度，不是暫時的 RPM 限制；本輪不會自動重試。",
        notes: "請等待太平洋時間午夜重置；頁面會換算成台灣時間倒數。",
        diagnostic_title: "⛔ Gemini 今日模型請求額度已滿（RPD）",
        diagnostic_lines: ["本輪掃描立即停止。", "已完成結果全部保留。", ...quotaLines],
        retryable: false,
        retry_wait_seconds: 0,
        stop_batch: true,
        quota_kind: "RPD"
      },
      quota_search_rpd: {
        status: "search_incomplete",
        failure_type: "quota_search_rpd",
        summary: "Google Search Grounding 今日額度已達上限",
        impact: "Gemini 一般文字功能可能仍可用，但目前無法繼續執行外部網路搜尋。",
        notes: "本輪不會重試；請等待每日搜尋額度重置。",
        diagnostic_title: "⛔ Google Search Grounding 今日額度已滿",
        diagnostic_lines: ["外部風險搜尋已停止。", "已完成結果全部保留。", ...quotaLines],
        retryable: false,
        retry_wait_seconds: 0,
        stop_batch: true,
        quota_kind: "Search RPD"
      },
      rate_limit_unknown_429: {
        status: "search_incomplete",
        failure_type: "rate_limit_unknown_429",
        summary: "Gemini 暫時受到使用限制（HTTP 429）",
        impact: "Google 沒有提供足以確認 RPM、TPM 或 RPD 的欄位；這不能直接解讀成每日額度用完。",
        notes: "系統等待 90 秒後，只重試目前球員一次。",
        diagnostic_title: "⚠ Gemini 429 限制種類無法確認",
        diagnostic_lines: ["可能是每分鐘請求數、每分鐘 Token 或專案暫時限制。", "第二次仍失敗時會停止整批，避免持續撞 API。", ...quotaLines],
        retryable: true,
        retry_wait_seconds: retryAfter ?? RETRY_UNKNOWN_429_SECONDS,
        stop_batch: false,
        quota_kind: "429 未辨識"
      },
      service_unavailable_503: {
        status: "search_incomplete",
        failure_type: "service_unavailable_503",
        summary: "Gemini 服務暫時壅塞（HTTP 503）",
        impact: "這不是你的 RPM、RPD 或 Google Search 額度用完。",
        notes: "系統會等待 30 秒，並只重試目前球員一次。",
        diagnostic_title: "⚠ Gemini 服務暫時壅塞（HTTP 503）",
        diagnostic_lines: ["Google 服務目前暫時無法處理請求。", "已完成結果不受影響。"],
        retryable: true,
        retry_wait_seconds: retryAfter ?? RETRY_503_SECONDS,
        stop_batch: false,
        quota_kind: null
      },
      service_unavailable_5xx: {
        status: "search_incomplete",
        failure_type: "service_unavailable_5xx",
        summary: "Gemini 上游服務暫時錯誤",
        impact: "這不是已確認的額度問題。",
        notes: "系統會等待 30 秒，並只重試目前球員一次。",
        diagnostic_title: "⚠ Gemini 上游服務暫時錯誤",
        diagnostic_lines: ["Google 或 Cloudflare 上游暫時無法完成請求。", "已完成結果不受影響。"],
        retryable: true,
        retry_wait_seconds: retryAfter ?? RETRY_503_SECONDS,
        stop_batch: false,
        quota_kind: null
      },
      network_timeout: {
        status: "search_incomplete",
        failure_type: "network_timeout",
        summary: "網路或 Cloudflare Worker 連線逾時",
        impact: "Gemini 尚未回傳有效結果；這不是已確認的額度問題。",
        notes: "系統會等待 20 秒，並只重試目前球員一次。",
        diagnostic_title: "⚠ 網路或 Worker 連線逾時",
        diagnostic_lines: ["目前球員尚未完成查證。", "已完成結果不受影響。"],
        retryable: true,
        retry_wait_seconds: RETRY_NETWORK_SECONDS,
        stop_batch: false,
        quota_kind: null
      },
      auth_401_403: {
        status: "system_error",
        failure_type: "auth_401_403",
        summary: "Gemini API Key、Worker Token 或專案權限錯誤",
        impact: "這是系統設定問題，不是球員風險。",
        notes: "請檢查 Cloudflare Worker 的 GEMINI_API_KEY、UPLOAD_TOKEN 與 Google 專案權限。",
        diagnostic_title: "⛔ Gemini API Key 或權限錯誤",
        diagnostic_lines: ["可能原因：API Key 無效、API 未啟用、Key 限制或專案權限不足。", "本輪掃描停止，不會自動重試。"],
        retryable: false,
        retry_wait_seconds: 0,
        stop_batch: true,
        quota_kind: null
      },
      location_unsupported: {
        status: "system_error",
        failure_type: "location_unsupported",
        summary: "Gemini API 不支援目前請求位置",
        impact: "這不是額度問題，也不是 RPM 限制。",
        notes: "請求由 Cloudflare Worker 所在位置送出，Google 拒絕該地區使用。",
        diagnostic_title: "⛔ Gemini API 目前不支援此請求位置",
        diagnostic_lines: ["本輪掃描停止，不會自動重試。", "請檢查 Worker 路由或執行地區。"],
        retryable: false,
        retry_wait_seconds: 0,
        stop_batch: true,
        quota_kind: null
      },
      model_unavailable_404: {
        status: "system_error",
        failure_type: "model_unavailable_404",
        summary: "Gemini 模型目前不可用",
        impact: "可能是模型名稱失效、模型已停用，或目前專案沒有權限。",
        notes: `請檢查模型名稱：${RISK_MODEL}。`,
        diagnostic_title: "⛔ Gemini 模型目前不可用",
        diagnostic_lines: [`模型：${RISK_MODEL}`, "本輪掃描停止，不會自動重試。"],
        retryable: false,
        retry_wait_seconds: 0,
        stop_batch: true,
        quota_kind: null
      },
      request_too_large_413: {
        status: "system_error",
        failure_type: "request_too_large_413",
        summary: "Gemini 請求資料過大（HTTP 413）",
        impact: "這不是額度問題；目前球員的請求內容超過上游可接受大小。",
        notes: "請檢查 Worker 提示詞與傳送欄位；本輪停止，避免重複送出相同大請求。",
        diagnostic_title: "⛔ Gemini 請求資料過大（HTTP 413）",
        diagnostic_lines: ["本輪掃描停止，不會自動重試。"],
        retryable: false,
        retry_wait_seconds: 0,
        stop_batch: true,
        quota_kind: null
      },
      configuration_error: {
        status: "system_error",
        failure_type: "configuration_error",
        summary: "Cloudflare Worker 的 Gemini 設定尚未完成",
        impact: "這是系統設定問題，不是球員風險。",
        notes: "請確認 GEMINI_API_KEY Secret 已建立並重新 Deploy Worker。",
        diagnostic_title: "⛔ Gemini 設定尚未完成",
        diagnostic_lines: ["本輪掃描停止，不會自動重試。"],
        retryable: false,
        retry_wait_seconds: 0,
        stop_batch: true,
        quota_kind: null
      }
    };
    return map[category] || {
      status: "search_incomplete",
      failure_type: "unknown_error",
      summary: "Gemini 或網路沒有完成本場搜尋",
      impact: "目前無法確認是額度、網路或上游服務問題。",
      notes: "本輪停止，避免在原因不明時持續撞 API。",
      diagnostic_title: "⚠ Gemini 未知錯誤",
      diagnostic_lines: [diagnostic.rawMessage || "上游沒有提供可辨識的錯誤資訊。"],
      retryable: false,
      retry_wait_seconds: 0,
      stop_batch: true,
      quota_kind: null
    };
  }

  function riskFailure(error) {
    const diagnostic = frontendGeminiErrorDiagnostic(error);
    const rawText = String(diagnostic.rawMessage || "").toLowerCase();
    let category = diagnostic.category;
    if (/尚未設定 gemini_api_key|gemini 設定尚未完成|cloudflare worker 尚未設定 gemini_api_key/.test(rawText)) {
      category = "configuration_error";
    }
    const detail = failureDetails(category, diagnostic);
    return {
      ...detail,
      http_status: diagnostic.httpStatus,
      retry_after_seconds: diagnostic.retryAfterSeconds,
      quota_metric: diagnostic.quotaMetric,
      quota_id: diagnostic.quotaId,
      quota_value: diagnostic.quotaValue,
      technical_error: diagnostic.rawMessage
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
    const attempt = Math.max(1, Number(options.attempt || 1));
    try {
      const response = await enqueueGeminiRequest(
        () => fetchJson(`${options.workerUrl}${GEMINI_RISK_PATH}`, {
          token: options.workerToken,
          fetchImpl: options.fetchImpl,
          body: {
            match,
            retry_mode: options.compactRetry ? "compact" : "normal"
          }
        }),
        { onQueueState: options.onQueueState }
      );
      const answer = geminiText(response.payload);
      const grounding = geminiGrounding(response.payload);
      let parsed = parseRiskResponse(answer);

      // 搜尋已完成但格式不完整時，不再浪費第二次請求。
      // 保留原始中文內容並轉為人工判讀。
      if (!parsed) {
        parsed = {
          status: "manual_review",
          severity: "unknown",
          confidence: 0.35,
          summary: grounding.sources.length
            ? "Gemini 已完成搜尋，但回覆格式不完整，請人工判讀。"
            : "Gemini 已提供資訊，但沒有足夠來源可確認風險。",
          impact: "下方保留本次完整回覆與可用來源，不會因格式問題而隱藏資訊。",
          findings: [],
          evidence: [],
          notes: "格式異常不會觸發重試，以免浪費一次搜尋請求；未列為紅色警示不等於已確認安全。",
          raw_summary: answer
        };
      }

      let status = normalizeRiskStatus(parsed.status);
      let severity = parsed.severity;
      let summary = parsed.summary;
      let impact = parsed.impact;
      let notes = parsed.notes;
      const findings = parsed.findings;

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
        risk_pipeline_version: "gemini-search-safe-v2",
        retry_count: attempt - 1,
        attempt_count: attempt,
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
        cache_hours: 0,
        cache_until: null,
        used_cache: false,
        checked_at: checkedAt.toISOString(),
        model: RISK_MODEL,
        requested_model: RISK_MODEL,
        search_mode: "gemini_2_5_flash_google_search",
        risk_pipeline_version: "gemini-search-safe-v2",
        retry_count: attempt - 1,
        attempt_count: attempt,
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
      if (String(entry?.risk_pipeline_version || "") !== "gemini-search-safe-v2") continue;
      const checkedAt = Date.parse(String(entry?.checked_at || ""));
      if (!Number.isFinite(checkedAt) || nowMs - checkedAt > RISK_RESOLVED_CACHE_HOURS * 3600000) continue;
      playerMap.set(normalizeRiskKeyPart(entry?.hot_player), entry);
    }

    function cachedEntryForRow(row) {
      const key = externalRiskMatchKey(row);
      const oldEntry = existingMap.get(key);
      if (isRiskCacheFresh(oldEntry, row, nowMs)) {
        return { entry: { ...oldEntry, used_cache: true, last_used_at: new Date().toISOString() }, fromCache: true };
      }
      const playerEntry = playerMap.get(normalizeRiskKeyPart(row?.熱門方));
      if (playerEntry && isRiskResolvedStatus(playerEntry.status)) {
        return { entry: clonePlayerRisk(playerEntry, row, true), fromCache: true };
      }
      return { entry: null, fromCache: false };
    }

    function nextApiRow(startIndex) {
      for (let index = startIndex; index < eligibleRows.length; index += 1) {
        if (!cachedEntryForRow(eligibleRows[index]).entry) return eligibleRows[index];
      }
      return null;
    }

    const entries = [];
    let completed = 0;
    let apiAttempts = 0;
    let scannedPlayers = 0;
    let cached = 0;
    let stoppedEarly = false;
    let stopEntry = null;

    for (let rowIndex = 0; rowIndex < eligibleRows.length; rowIndex += 1) {
      const row = eligibleRows[rowIndex];
      let { entry, fromCache } = cachedEntryForRow(row);

      if (entry) {
        cached += 1;
      } else {
        if (typeof options.onPending === "function") {
          await options.onPending(row, { completed, total: eligibleRows.length });
        }

        scannedPlayers += 1;
        let attempt = 1;
        let previousFailure = null;
        while (attempt <= RISK_MAX_ATTEMPTS) {
          entry = await scanExternalRisk(row, {
            ...options,
            attempt,
            compactRetry: previousFailure?.failure_type === "rate_limit_tpm"
          });
          apiAttempts += 1;

          if (isRiskResolvedStatus(entry.status)) break;

          const retryable = Boolean(entry.retryable);
          if (!retryable || attempt >= RISK_MAX_ATTEMPTS) {
            if (attempt >= RISK_MAX_ATTEMPTS && retryable) {
              entry = {
                ...entry,
                stop_batch: true,
                notes: `${entry.notes || ""} 第二次仍失敗，本輪停止，避免持續撞 API。`.trim(),
                diagnostic_lines: [
                  ...(Array.isArray(entry.diagnostic_lines) ? entry.diagnostic_lines : []),
                  "第二次嘗試仍未成功；未完成球員保留到下一輪。"
                ]
              };
            }
            stoppedEarly = Boolean(entry.stop_batch);
            if (stoppedEarly) stopEntry = entry;
            break;
          }

          const waitSeconds = Math.max(1, Number(entry.retry_wait_seconds || entry.retry_after_seconds || RETRY_UNKNOWN_429_SECONDS));
          if (typeof options.onRetryWait === "function") {
            await waitWithCountdown(waitSeconds * 1000, async info => {
              await options.onRetryWait(entry, {
                ...info,
                row,
                attempt,
                completed,
                total: eligibleRows.length
              });
            });
          } else {
            await sleep(waitSeconds * 1000);
          }
          previousFailure = entry;
          attempt += 1;
        }

        if (isRiskResolvedStatus(entry?.status)) {
          playerMap.set(normalizeRiskKeyPart(entry.hot_player), entry);
        }
      }

      if (stoppedEarly && entry) {
        const savedBeforeStop = entries.filter(candidate =>
          isRiskResolvedStatus(candidate?.status)
        ).length;
        entry = {
          ...entry,
          scan_total: eligibleRows.length,
          scan_saved: savedBeforeStop,
          scan_remaining: eligibleRows.length - savedBeforeStop,
          scan_current_player: String(row?.熱門方 || entry?.hot_player || "")
        };
        stopEntry = entry;
      }

      entries.push(entry);
      completed += 1;

      if (typeof options.onEntry === "function") {
        await options.onEntry(entry, {
          completed,
          total: eligibleRows.length,
          scanned: apiAttempts,
          scannedPlayers,
          cached,
          row,
          fromCache
        });
      }
      if (typeof options.onProgress === "function") {
        options.onProgress({ completed, total: eligibleRows.length, scanned: apiAttempts, scannedPlayers, cached, row, entry, fromCache });
      }

      if (stoppedEarly) {
        if (typeof options.onStop === "function") {
          await options.onStop(stopEntry, {
            completed: Number(stopEntry?.scan_saved || 0),
            processed: completed,
            total: eligibleRows.length,
            remaining: Number(stopEntry?.scan_remaining || (eligibleRows.length - completed)),
            row
          });
        }
        break;
      }

      if (!fromCache && isRiskResolvedStatus(entry?.status)) {
        const nextRow = nextApiRow(rowIndex + 1);
        if (nextRow) {
          const cooldownMs = randomInteger(
            Number(options.delayMinMs) || RISK_SCAN_DELAY_MIN_MS,
            Number(options.delayMaxMs) || RISK_SCAN_DELAY_MAX_MS
          );
          if (typeof options.onCooldown === "function") {
            await waitWithCountdown(cooldownMs, async info => {
              await options.onCooldown({
                ...info,
                completed,
                total: eligibleRows.length,
                currentRow: row,
                nextRow
              });
            });
          } else {
            await sleep(cooldownMs);
          }
        }
      }
    }

    const remaining = eligibleRows.length - completed;
    return {
      entries,
      total: eligibleRows.length,
      completed,
      scanned: apiAttempts,
      scannedPlayers,
      cached,
      stoppedEarly,
      stopEntry,
      remaining,
      unresolved: entries.filter(entry => !isRiskResolvedStatus(entry.status)).length + remaining
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

    const response = await enqueueGeminiRequest(
      () => fetchJson(`${options.workerUrl}${GEMINI_CHAT_PATH}`, {
        token: options.workerToken,
        fetchImpl: options.fetchImpl,
        body
      }),
      { onQueueState: options.onQueueState }
    );
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
    ask,
    RISK_SCAN_DELAY_MIN_MS,
    RISK_SCAN_DELAY_MAX_MS,
    frontendGeminiErrorDiagnostic,
    riskFailure
  });
})(typeof window !== "undefined" ? window : globalThis);
