((global) => {
  "use strict";

  const DEFAULT_MODEL = "gemini-2.5-flash";
  const DEFAULT_WORKER_PATH = "/gemini";
  const MAX_HISTORY_MESSAGES = 6;
  const MAX_SELECTED_MATCHES = 4;
  const MAX_RETRIES = 3;
  const REQUEST_TIMEOUT_MS = 120000;
  const RISK_SCAN_DELAY_MS = 1400;
  const RISK_RESOLVED_CACHE_HOURS = 6;

  const DEFAULT_SYSTEM_PROMPT =
    "你是 TennisRatio 網球賽事分析助理。全程使用繁體中文，回答清楚、精確、可覆盤。" +
    "以系統附上的 Pinnacle 與 ratio_analysis.json 資料為主，不得捏造賠率、勝率、評級、D值或五項比較。" +
    "先區分市場定義、機械評級與外網查證；外網資料只能作為傷病、賽程、旅行、近期狀態與官方消息的補充。" +
    "若使用外網，回答結尾列出資料來源；找不到可靠資料要明說。" +
    "不要承諾獲利，也不要把單場勝率描述成必然結果。";

  function unique(values) {
    return [...new Set(values)];
  }

  function itemNumber(value) {
    const number = Number.parseInt(String(value ?? "").trim(), 10);
    return Number.isFinite(number) ? number : null;
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

  function overviewQuestion(question) {
    const text = String(question || "").toLocaleLowerCase("zh-Hant");
    const keywords = [
      "全部", "整體", "所有", "哪幾場", "哪些場", "最高", "最低",
      "排行", "排名", "前三", "前3", "前五", "前5", "整理abc",
      "比較各場", "比較全部", "總覽", "清單"
    ];
    return keywords.some(keyword => text.includes(keyword));
  }

  function compactRow(row) {
    const keys = [
      "項次", "日期時間", "聯賽", "主場", "客場", "主場名次", "客場名次",
      "主場賠率", "客場賠率", "熱門方", "熱門方賠率", "賠轉勝率",
      "Pinnacle去水勝率", "公式B勝率", "評級勝率", "公式B EV百分比",
      "評級EV百分比", "公式B狀態", "評級", "分析狀態", "判定原因"
    ];
    const output = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row || {}, key)) {
        output[key] = row[key];
      }
    }
    return output;
  }

  function buildContext(question, options = {}) {
    const payload = options.payload && typeof options.payload === "object"
      ? options.payload
      : {};
    const analysis = options.analysis && typeof options.analysis === "object"
      ? options.analysis
      : {};
    const rows = Array.isArray(options.rows)
      ? options.rows
      : (Array.isArray(analysis.matches) ? analysis.matches : []);
    const history = Array.isArray(options.history) ? options.history : [];
    const revision = Number(options.revision || 0);

    let selectedItems = unique([
      ...explicitItemMentions(question),
      ...fullNameMentions(question, rows)
    ]);
    let selectionSource = selectedItems.length ? "current_question" : "";

    if (!selectedItems.length && !overviewQuestion(question)) {
      for (const item of history.slice(-MAX_HISTORY_MESSAGES).reverse()) {
        if (!item || typeof item !== "object") continue;
        const text = String(item.text || item.content || "");
        const references = unique([
          ...explicitItemMentions(text),
          ...fullNameMentions(text, rows)
        ]);
        if (references.length) {
          selectedItems = references;
          selectionSource = "conversation_history";
          break;
        }
      }
    }

    const validItems = new Set(
      rows.map(row => itemNumber(row?.項次)).filter(value => value !== null)
    );
    selectedItems = selectedItems
      .filter(item => validItems.has(item))
      .slice(0, MAX_SELECTED_MATCHES);
    const selectedSet = new Set(selectedItems);
    const selectedRows = rows.filter(row => selectedSet.has(itemNumber(row?.項次)));

    const base = {
      context_schema: "tennisratio-question-context-v3-js",
      revision,
      batch_date: payload.batch_date ?? null,
      pinnacle_query_time: payload.query_time ?? null,
      ratio_generated_at_taiwan: analysis.generated_at_taiwan ?? null,
      total_match_count: rows.length
    };

    if (selectedRows.length) {
      const analysisRows = (Array.isArray(analysis.matches) ? analysis.matches : [])
        .filter(row => row && selectedSet.has(itemNumber(row.項次)));
      const sourceRows = (Array.isArray(payload.matches) ? payload.matches : [])
        .filter(row => row && selectedSet.has(itemNumber(row.項次)));
      return {
        ...base,
        context_mode: "selected_matches",
        selection_source: selectionSource,
        selected_items: selectedItems,
        sent_match_count: selectedRows.length,
        selected_table_rows: selectedRows,
        selected_ratio_analysis_matches: analysisRows,
        selected_today_matches: sourceRows
      };
    }

    return {
      ...base,
      context_mode: "compact_overview",
      selection_source: "overview_or_unresolved",
      selected_items: [],
      sent_match_count: rows.length,
      table_rows_compact: rows.map(compactRow),
      note: "跨場比較只傳精簡表，不重複傳送完整巢狀JSON。"
    };
  }

  function extractText(payload) {
    const chunks = [];
    for (const candidate of Array.isArray(payload?.candidates) ? payload.candidates : []) {
      for (const part of Array.isArray(candidate?.content?.parts)
        ? candidate.content.parts
        : []) {
        if (typeof part?.text === "string" && part.text.trim()) {
          chunks.push(part.text.trim());
        }
      }
    }
    const text = chunks.join("\n").trim();
    if (text) return text;
    const blockReason = payload?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new Error(`Gemini未回覆，內容被阻擋：${blockReason}`);
    }
    const finishReason = payload?.candidates?.[0]?.finishReason;
    if (finishReason) {
      throw new Error(`Gemini回應中沒有可顯示文字：${finishReason}`);
    }
    throw new Error("Gemini回應中沒有可顯示文字。");
  }

  function extractGrounding(payload) {
    const sources = [];
    const queries = [];
    const seenUrls = new Set();
    for (const candidate of Array.isArray(payload?.candidates) ? payload.candidates : []) {
      const metadata = candidate?.groundingMetadata || {};
      for (const query of Array.isArray(metadata.webSearchQueries)
        ? metadata.webSearchQueries
        : []) {
        const text = String(query || "").trim();
        if (text && !queries.includes(text)) queries.push(text);
      }
      for (const chunk of Array.isArray(metadata.groundingChunks)
        ? metadata.groundingChunks
        : []) {
        const web = chunk?.web || {};
        const uri = String(web.uri || "").trim();
        if (!uri || seenUrls.has(uri)) continue;
        seenUrls.add(uri);
        sources.push({
          title: String(web.title || uri || "網頁來源"),
          uri
        });
      }
    }
    return {
      sources: sources.slice(0, 10),
      queries: queries.slice(0, 10)
    };
  }

  function taipeiTimeText() {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      })
        .formatToParts(new Date())
        .filter(part => part.type !== "literal")
        .map(part => [part.type, part.value])
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
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
    const date = String(row?.["日期時間"] || "")
      .trim()
      .replace(/\s+/g, "T");
    const home = normalizeRiskKeyPart(row?.["主場"]);
    const away = normalizeRiskKeyPart(row?.["客場"]);
    return `${date}|${home}|${away}`;
  }

  function parseTaipeiMatchTime(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const normalized = raw.includes("T")
      ? raw
      : raw.replace(" ", "T");
    const withZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
      ? normalized
      : (/T\d{2}:\d{2}:\d{2}$/.test(normalized)
        ? `${normalized}+08:00`
        : `${normalized}:00+08:00`);
    const time = Date.parse(withZone);
    return Number.isFinite(time) ? time : null;
  }

  function isExternalRiskEligible(row, nowMs = Date.now()) {
    const rating = String(row?.["評級"] || "").trim();
    if (!["A", "B"].includes(rating)) return false;
    if (row?.["已過期"] === true) return false;
    const matchTime = parseTaipeiMatchTime(row?.["日期時間"]);
    if (
      Number.isFinite(matchTime) &&
      nowMs > matchTime + 15 * 60 * 1000
    ) {
      return false;
    }
    return Boolean(String(row?.["熱門方"] || "").trim());
  }

  function normalizeRiskStatus(value) {
    const status = String(value || "");

    // 舊版 insufficient 直接視為 manual_review。
    if (status === "insufficient") {
      return "manual_review";
    }

    if ([
      "format_error",
      "quota_429",
      "network_timeout",
      "failed"
    ].includes(status)) {
      return "search_incomplete";
    }

    if (status === "auth_401_403") {
      return "system_error";
    }

    return status;
  }

  function isRiskResolvedStatus(value) {
    return [
      "risk_found",
      "clear",
      "manual_review"
    ].includes(normalizeRiskStatus(value));
  }

  function isRiskFailureStatus(value) {
    return [
      "search_incomplete",
      "system_error"
    ].includes(normalizeRiskStatus(value));
  }

  function riskCacheHours(entry) {
    const status = normalizeRiskStatus(entry?.status);

    if ([
      "risk_found",
      "clear",
      "manual_review"
    ].includes(status)) {
      const explicit = Number(entry?.cache_hours);
      return Number.isFinite(explicit) && explicit > 0
        ? explicit
        : RISK_RESOLVED_CACHE_HOURS;
    }

    return 0;
  }

  function isRiskCacheFresh(entry, row, nowMs = Date.now()) {
    if (!entry || !isRiskResolvedStatus(entry.status)) {
      return false;
    }
    if (
      String(entry.match_key || "") !==
      externalRiskMatchKey(row)
    ) {
      return false;
    }
    if (
      String(entry.hot_player || "") !==
      String(row?.["熱門方"] || "")
    ) {
      return false;
    }
    if (
      String(entry.rating || "") !==
      String(row?.["評級"] || "")
    ) {
      return false;
    }

    const checkedAt = Date.parse(
      String(entry.checked_at || "")
    );
    if (!Number.isFinite(checkedAt)) return false;

    const hours = riskCacheHours(entry);
    if (!(hours > 0)) return false;

    return (
      nowMs - checkedAt <=
      hours * 3600000
    );
  }

  function compactRiskMatch(row) {
    const model = row?.["模型"] &&
      typeof row["模型"] === "object"
      ? row["模型"]
      : {};
    return {
      match_key: externalRiskMatchKey(row),
      item: row?.["項次"] ?? null,
      date_time_taipei: row?.["日期時間"] ?? null,
      league: row?.["聯賽"] ?? null,
      tournament_level:
        row?.["比賽資訊"]?.tournament_level ?? null,
      round: row?.["比賽資訊"]?.round_name ?? null,
      surface: row?.["比賽資訊"]?.surface ?? null,
      home: row?.["主場"] ?? null,
      away: row?.["客場"] ?? null,
      hot_player: row?.["熱門方"] ?? null,
      hot_side: row?.["熱門方位置"] ?? null,
      hot_odds: row?.["熱門方賠率"] ?? null,
      hot_rank:
        row?.["熱門方位置"] === "主場"
          ? row?.["主場名次"]
          : row?.["客場名次"],
      opponent_rank:
        row?.["熱門方位置"] === "主場"
          ? row?.["客場名次"]
          : row?.["主場名次"],
      rating: row?.["評級"] ?? null,
      rating_probability:
        row?.["評級勝率"] ?? row?.["公式B勝率"] ?? null,
      rating_ev:
        row?.["評級EV"] ?? row?.["公式B EV"] ?? null,
      d_value: model?.["D數據差"] ?? null,
      five_support:
        model?.["熱門方五項較優數"] ?? null,
      five_total:
        model?.["五項比較數"] ?? null
    };
  }

  function stripJsonFence(text) {
    const value = String(text || "").trim();
    const fenced = value.match(
      /^```(?:json)?\s*([\s\S]*?)\s*```$/i
    );
    const candidate = fenced ? fenced[1].trim() : value;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("Gemini 外部風險回覆不是 JSON。");
    }
    return candidate.slice(start, end + 1);
  }

  function parseRiskResponse(text) {
    let parsed;
    try {
      parsed = JSON.parse(stripJsonFence(text));
    } catch (error) {
      throw new Error(
        `Gemini 外部風險 JSON 解析失敗：${error.message}`
      );
    }

    const allowedStatus = new Set([
      "risk_found",
      "clear",
      "manual_review",
      // 相容舊格式。
      "insufficient"
    ]);
    const allowedSeverity = new Set([
      "high",
      "medium",
      "none",
      "unknown"
    ]);
    const allowedCategories = new Set([
      "injury",
      "illness",
      "retirement",
      "fatigue",
      "schedule",
      "travel",
      "official_status",
      "training",
      "form",
      "neutral",
      "other"
    ]);

    const rawStatus = allowedStatus.has(
      String(parsed?.status)
    )
      ? String(parsed.status)
      : "manual_review";
    const status = normalizeRiskStatus(rawStatus);

    const severity = allowedSeverity.has(
      String(parsed?.severity)
    )
      ? String(parsed.severity)
      : (
          status === "clear"
            ? "none"
            : "unknown"
        );

    const confidenceValue = Number(parsed?.confidence);
    const confidence = Number.isFinite(confidenceValue)
      ? Math.max(0, Math.min(1, confidenceValue))
      : 0;

    const rawFindings = Array.isArray(parsed?.findings)
      ? parsed.findings
      : (
          Array.isArray(parsed?.evidence)
            ? parsed.evidence
            : []
        );

    const findings = rawFindings
      .slice(0, 12)
      .map(item => ({
        date:
          String(item?.date || "").trim() || null,
        category: allowedCategories.has(
          String(item?.category || "")
        )
          ? String(item.category)
          : "other",
        title:
          String(
            item?.title ||
            item?.fact ||
            "近期資訊"
          ).trim().slice(0, 240),
        fact:
          String(
            item?.fact ||
            item?.title ||
            ""
          ).trim().slice(0, 900),
        relevance:
          String(
            item?.relevance ||
            item?.possible_relevance ||
            ""
          ).trim().slice(0, 900),
        direction:
          ["negative", "neutral", "positive"].includes(
            String(item?.direction || "")
          )
            ? String(item.direction)
            : "neutral"
      }))
      .filter(item => item.fact || item.title);

    return {
      status,
      severity,
      confidence,
      summary:
        String(parsed?.summary || "")
          .trim()
          .slice(0, 1200),
      impact:
        String(parsed?.impact || "")
          .trim()
          .slice(0, 1200),
      findings,
      // 相容既有畫面欄位。
      evidence: findings,
      notes:
        String(parsed?.notes || "")
          .trim()
          .slice(0, 1200),
      raw_summary:
        String(
          parsed?.raw_summary ||
          parsed?.search_summary ||
          ""
        ).trim().slice(0, 12000)
    };
  }


  function createRiskRequestError(
    message,
    {
      failureType = "network_timeout",
      httpStatus = null,
      retryAfterSeconds = null,
      cause = null
    } = {}
  ) {
    const error = new Error(message);
    error.failureType = failureType;
    error.httpStatus = httpStatus;
    error.retryAfterSeconds = retryAfterSeconds;
    error.cause = cause;
    return error;
  }

  function friendlyRiskFailure(error) {
    const technicalError =
      error?.message || String(error || "未知錯誤");
    const lower =
      technicalError.toLocaleLowerCase("en-US");

    let failureType = String(
      error?.failureType || ""
    );

    if (!failureType) {
      if (
        lower.includes("401") ||
        lower.includes("403") ||
        lower.includes("unauthorized") ||
        lower.includes("forbidden")
      ) {
        failureType = "auth_401_403";
      } else if (
        lower.includes("429") ||
        lower.includes("quota") ||
        lower.includes("rate limit")
      ) {
        failureType = "quota_429";
      } else if (
        lower.includes("json") ||
        technicalError.includes("回覆不是") ||
        technicalError.includes("解析失敗")
      ) {
        failureType = "format_error";
      } else {
        failureType = "network_timeout";
      }
    }

    if (failureType === "auth_401_403") {
      return {
        public_status: "system_error",
        failure_type: "auth_401_403",
        summary:
          "外部風險掃描暫停：Gemini API Key 或權限驗證失敗。",
        impact:
          "這是系統設定問題，不是任何一位球員的風險。",
        notes:
          "請檢查 Cloudflare Worker 的 GEMINI_API_KEY、UPLOAD_TOKEN 與權限設定。",
        http_status:
          Number(error?.httpStatus) || null,
        retry_after_seconds: null,
        technical_error: technicalError
      };
    }

    if (failureType === "quota_429") {
      return {
        public_status: "search_incomplete",
        failure_type: "quota_429",
        summary:
          "本場搜尋尚未完成：Gemini 暫時達到使用上限。",
        impact:
          "這是 API 使用量問題，不是球員風險。",
        notes:
          "系統會依服務回傳的等待時間暫停，再繼續其他場次；本場下次重新分析時會再查。",
        http_status:
          Number(error?.httpStatus) || 429,
        retry_after_seconds:
          Number(error?.retryAfterSeconds) || null,
        technical_error: technicalError
      };
    }

    if (failureType === "format_error") {
      return {
        public_status: "search_incomplete",
        failure_type: "format_error",
        summary:
          "本場搜尋尚未完成。",
        impact:
          "這次沒有取得可可靠呈現的搜尋內容，因此不會判定球員有風險或沒有風險。",
        notes:
          "灰色 ↻ 只代表需要重試。下次重新分析時會自動再查。",
        http_status: null,
        retry_after_seconds: null,
        technical_error: technicalError
      };
    }

    return {
      public_status: "search_incomplete",
      failure_type: "network_timeout",
      summary:
        "本場搜尋尚未完成：連線逾時或外部服務暫時沒有回應。",
      impact:
        "這不是球員風險，只代表這次沒有查完。",
      notes:
        "灰色 ↻ 代表下次重新分析會自動重試。",
      http_status:
        Number(error?.httpStatus) || null,
      retry_after_seconds: null,
      technical_error: technicalError
    };
  }

  async function repairRiskJson(
    rawAnswer,
    options = {}
  ) {
    const model =
      String(options.model || DEFAULT_MODEL).trim() ||
      DEFAULT_MODEL;

    const repairPayload = {
      systemInstruction: {
        parts: [{
          text:
            "你是 JSON 格式修復器。請把使用者提供的外部風險分析文字整理成指定 JSON。" +
            "不得新增原文沒有的事實、日期、來源或風險。只輸出 JSON，不要 Markdown。" +
            '格式：{"status":"risk_found|clear|manual_review","severity":"high|medium|none|unknown","confidence":0到1,"summary":"一句話結論","impact":"與本場的可能影響","findings":[{"date":"YYYY-MM-DD或null","category":"injury|illness|retirement|fatigue|schedule|travel|official_status|training|form|neutral|other","title":"簡短標題","fact":"找到的事實","relevance":"與本場的可能關係","direction":"negative|neutral|positive"}],"notes":"必要補充","raw_summary":"原始資訊摘要"}'
        }]
      },
      contents: [{
        role: "user",
        parts: [{
          text:
            "請只修復格式，不得改寫或補充事實：\n\n" +
            String(rawAnswer || "").slice(0, 12000)
        }]
      }],
      generationConfig: {
        ...generationConfigForModel(model),
        maxOutputTokens: 1800
      }
    };

    const response = await postRiskProxy({
      model,
      request: repairPayload
    }, options);

    return {
      parsed: parseRiskResponse(
        extractText(response.payload)
      ),
      retryCount: response.retryCount,
      requestBytes: response.requestBytes
    };
  }

  function buildRiskSystemText(row) {
    const match = compactRiskMatch(row);

    return (
      "你是 TennisRatio 的賽前外部資訊搜尋與風險覆核代理。全程使用繁體中文。" +
      "\n你的工作分成兩層：第一層整理搜尋到的所有近期資訊；第二層才判斷是否構成明確風險。" +
      "\n不可因為無法判斷風險，就刪除、隱藏或省略已找到的資訊。" +
      "\n必查：近期傷病、傷退、退賽、疾病、醫療暫停、體能、上一場耗時、短休連戰、密集賽程、旅行、訓練、官方或選手本人發言、近期狀態。" +
      "\nfindings 必須保存所有具體且與該球員近期狀況有關的資訊，即使它是中性、正面、與風險沒有直接關係，仍要留下供人類自行判讀。" +
      "\n狀態只允許三種：" +
      "\n1. risk_found：找到有日期、有可靠來源、與本場直接相關的明確不利資訊。" +
      "\n2. clear：搜尋成功，而且沒有找到任何值得呈現的近期異常或狀態資訊；findings 應為空。" +
      "\n3. manual_review：找到具體近期資訊，但不足以確定是明確風險，或正反資訊混合；必須完整保留 findings。" +
      "\n很久以前的舊傷、球迷猜測、無日期說法不能直接判定 risk_found，但若搜尋到且可能有參考價值，可放入 manual_review 並清楚標示限制。" +
      "\n若有任何具體 findings，卻不能確定為 risk_found，優先使用 manual_review，不要使用 clear。" +
      "\n只輸出一個 JSON 物件，不要 Markdown、不要程式碼圍欄、不要額外文字。" +
      '\nJSON格式：{"status":"risk_found|clear|manual_review","severity":"high|medium|none|unknown","confidence":0到1,"summary":"一句話結論","impact":"為何可能影響本場，沒有則留空","findings":[{"date":"YYYY-MM-DD或null","category":"injury|illness|retirement|fatigue|schedule|travel|official_status|training|form|neutral|other","title":"簡短標題","fact":"搜尋到的具體資訊","relevance":"與本場的可能關係","direction":"negative|neutral|positive"}],"notes":"限制或補充","raw_summary":"將搜尋結果整理成可閱讀摘要"}' +
      `\n目前台灣時間：${taipeiTimeText()}` +
      "\n【本場資料】\n" +
      JSON.stringify(match)
    );
  }

  async function postRiskProxy(proxyPayload, options = {}) {
    const workerUrl = String(
      options.workerUrl || ""
    ).trim().replace(/\/+$/, "");
    const workerToken = String(
      options.workerToken || ""
    ).trim();

    if (!workerUrl.startsWith("https://")) {
      throw new Error(
        "Gemini Worker URL 必須使用 https://。"
      );
    }
    if (!workerToken) {
      throw new Error(
        "缺少 Cloudflare Worker 驗證 Token。"
      );
    }

    const endpoint =
      `${workerUrl}${DEFAULT_WORKER_PATH}`;
    const fetchImpl =
      options.fetchImpl || global.fetch?.bind(global);
    if (typeof fetchImpl !== "function") {
      throw new Error("目前瀏覽器不支援 fetch。");
    }

    const encodedText = JSON.stringify(proxyPayload);
    const requestBytes =
      new TextEncoder().encode(encodedText).byteLength;
    let responsePayload = null;
    let retryCount = 0;

    for (
      let attempt = 0;
      attempt <= MAX_RETRIES;
      attempt += 1
    ) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
      );

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json; charset=utf-8",
            Authorization: `Bearer ${workerToken}`
          },
          body: encodedText,
          signal: controller.signal,
          cache: "no-store"
        });

        if (response.ok) {
          responsePayload = await response.json();
          break;
        }

        const detail = await readErrorDetail(response);
        const retryable =
          response.status === 429 ||
          [500, 502, 503, 504].includes(response.status);

        if (retryable && attempt < MAX_RETRIES) {
          retryCount += 1;
          const wait = response.status === 429
            ? retrySeconds(response, detail, attempt)
            : Math.min(1.5 * (2 ** attempt), 12);
          await sleep(wait * 1000);
          continue;
        }

        if ([401, 403].includes(response.status)) {
          throw createRiskRequestError(
            `Gemini Worker錯誤 HTTP ${response.status}：${detail}`,
            {
              failureType: "auth_401_403",
              httpStatus: response.status
            }
          );
        }

        if (response.status === 429) {
          throw createRiskRequestError(
            `Gemini Worker錯誤 HTTP 429：${detail}`,
            {
              failureType: "quota_429",
              httpStatus: 429,
              retryAfterSeconds:
                retrySeconds(
                  response,
                  detail,
                  attempt
                )
            }
          );
        }

        throw createRiskRequestError(
          `Gemini Worker錯誤 HTTP ${response.status}：${detail}`,
          {
            failureType: "network_timeout",
            httpStatus: response.status
          }
        );
      } catch (error) {
        if (error?.failureType) {
          throw error;
        }

        const isAbort = error?.name === "AbortError";
        const retryableNetwork =
          isAbort || error instanceof TypeError;

        if (
          retryableNetwork &&
          attempt < MAX_RETRIES
        ) {
          retryCount += 1;
          await sleep(
            Math.min(1.5 * (2 ** attempt), 12) *
            1000
          );
          continue;
        }

        if (isAbort || error instanceof TypeError) {
          throw createRiskRequestError(
            isAbort
              ? "Gemini Worker連線逾時。"
              : "Gemini Worker網路連線失敗。",
            {
              failureType: "network_timeout",
              cause: error
            }
          );
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!responsePayload) {
      throw createRiskRequestError(
        "Gemini Worker沒有回傳資料。",
        {
          failureType: "network_timeout"
        }
      );
    }

    return {
      payload: responsePayload,
      retryCount,
      requestBytes
    };
  }


  function buildReadableRiskSummary(
    parsed,
    fallbackText = ""
  ) {
    const direct = String(
      parsed?.raw_summary || ""
    ).trim();

    if (
      direct &&
      !/^\s*(?:```)?json\b/i.test(direct) &&
      !/^\s*\{[\s\S]*\}\s*$/.test(direct)
    ) {
      return direct.slice(0, 12000);
    }

    const lines = [];
    const findings = Array.isArray(
      parsed?.findings
    )
      ? parsed.findings
      : (
          Array.isArray(parsed?.evidence)
            ? parsed.evidence
            : []
        );

    findings.forEach((finding, index) => {
      const date =
        String(finding?.date || "").trim() ||
        "日期未明";
      const title =
        String(
          finding?.title ||
          finding?.fact ||
          "近期資訊"
        ).trim();
      const fact =
        String(finding?.fact || "").trim();
      const relevance =
        String(
          finding?.relevance ||
          finding?.possible_relevance ||
          ""
        ).trim();

      lines.push(
        `${index + 1}. ${date}｜${title}`
      );

      if (
        fact &&
        fact !== title
      ) {
        lines.push(`   ${fact}`);
      }

      if (relevance) {
        lines.push(
          `   與本場可能關係：${relevance}`
        );
      }
    });

    if (!lines.length && parsed?.summary) {
      lines.push(
        String(parsed.summary).trim()
      );
    }

    if (parsed?.impact) {
      lines.push(
        `與本場可能關係：${
          String(parsed.impact).trim()
        }`
      );
    }

    if (parsed?.notes) {
      lines.push(
        `補充：${String(parsed.notes).trim()}`
      );
    }

    if (!lines.length) {
      const fallback =
        String(fallbackText || "")
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

      if (
        fallback &&
        !/^\s*\{[\s\S]*\}\s*$/.test(fallback)
      ) {
        lines.push(fallback);
      }
    }

    return lines
      .filter(Boolean)
      .join("\n")
      .slice(0, 12000);
  }

  async function scanExternalRisk(row, options = {}) {
    if (!isExternalRiskEligible(row)) {
      throw new Error(
        "此場不符合 A／B 外部風險掃描條件。"
      );
    }

    const model =
      String(options.model || DEFAULT_MODEL).trim() ||
      DEFAULT_MODEL;

    const requestPayload = {
      systemInstruction: {
        parts: [{
          text: buildRiskSystemText(row)
        }]
      },
      contents: [{
        role: "user",
        parts: [{
          text:
            "請立即使用 Google Search 搜尋本場熱門方，完整保留所有近期資訊，再依規則輸出 JSON。"
        }]
      }],
      tools: [{ google_search: {} }],
      generationConfig: {
        ...generationConfigForModel(model),
        maxOutputTokens: 2600
      }
    };

    const response = await postRiskProxy({
      model,
      request: requestPayload
    }, options);

    const answer = extractText(response.payload);
    const grounding =
      extractGrounding(response.payload);

    let parsed;
    let repairRetryCount = 0;
    let repairRequestBytes = 0;

    try {
      parsed = parseRiskResponse(answer);
    } catch (parseError) {
      try {
        const repaired = await repairRiskJson(
          answer,
          {
            ...options,
            model
          }
        );
        parsed = repaired.parsed;
        repairRetryCount =
          repaired.retryCount;
        repairRequestBytes =
          repaired.requestBytes;
      } catch (repairError) {
        if (repairError?.failureType) {
          throw repairError;
        }

        // 只要 Gemini 已經回覆任何可閱讀文字，就不得改成
        // search_incomplete。即使沒有 grounding 來源，也要保留
        // 回覆並交給人類自行判讀。
        if (String(answer || "").trim()) {
          const hasGrounding = Boolean(
            grounding.sources.length ||
            grounding.queries.length
          );

          parsed = {
            status: "manual_review",
            severity: "unknown",
            confidence: hasGrounding ? 0.35 : 0.2,
            summary: hasGrounding
              ? "已找到外部資訊，請由人類自行判讀。"
              : "Gemini 已提供近期資訊，但沒有附上可核對來源。",
            impact: hasGrounding
              ? "系統無法可靠判定這些資訊是否足以構成明確風險，但搜尋內容已完整保留。"
              : "系統不會把這場列為已確認安全；回覆內容仍完整保留，請自行判斷參考價值。",
            findings: [],
            evidence: [],
            notes: hasGrounding
              ? "以下保留 Gemini 本次搜尋整理與來源。沒有列為紅色風險，不等於資訊沒有參考價值。"
              : "這次有取得 Gemini 回覆，但沒有 Google Search 來源標記，因此改列人工判讀，而不是搜尋未完成。",
            raw_summary:
              String(answer).trim().slice(0, 12000)
          };
        } else {
          throw createRiskRequestError(
            "外部資訊搜尋沒有完整完成。",
            {
              failureType: "format_error",
              cause: repairError || parseError
            }
          );
        }
      }
    }

    let status =
      normalizeRiskStatus(parsed.status);
    let severity = parsed.severity;
    let summary = parsed.summary;
    let impact = parsed.impact;
    let notes = parsed.notes;
    const findings = Array.isArray(
      parsed.findings
    )
      ? parsed.findings
      : [];

    // 紅色風險未通過門檻時，不丟棄資訊，改成人工判讀。
    if (
      status === "risk_found" &&
      (
        parsed.confidence < 0.72 ||
        findings.length === 0 ||
        !findings.some(item =>
          /^\d{4}-\d{2}-\d{2}$/.test(
            String(item?.date || "")
          )
        ) ||
        !summary ||
        !impact ||
        grounding.sources.length === 0
      )
    ) {
      status = "manual_review";
      severity = "unknown";
      summary =
        summary ||
        "已找到外部資訊，但不足以列為紅色風險。";
      notes = [
        notes,
        "資訊未同時通過日期、來源、可信度與本場關聯門檻，因此交由人類自行判讀。"
      ].filter(Boolean).join(" ");
    }

    // 只要找到具體資訊，就不能用 clear 隱藏。
    if (
      status === "clear" &&
      findings.length > 0
    ) {
      status = "manual_review";
      severity = "unknown";
      summary =
        "已找到近期資訊，請由人類自行判讀。";
      notes = [
        notes,
        "因為存在具體 findings，系統不使用無圖示 clear。"
      ].filter(Boolean).join(" ");
    }

    // Gemini 不一定每次都真正啟用 Google Search 工具。
    // 若它有回覆 clear，但沒有 grounding 來源，不能標成
    // 「已確認安全」，也不能誤判成搜尋失敗；改成人工判讀，
    // 並把回覆文字完整保留。
    if (
      status === "clear" &&
      grounding.sources.length === 0 &&
      grounding.queries.length === 0
    ) {
      status = "manual_review";
      severity = "unknown";
      summary =
        "Gemini 回覆未發現明確風險，但沒有附上可核對來源。";
      impact =
        "這場不能列為已確認安全；請閱讀 Gemini 回覆後自行判斷。";
      notes = [
        notes,
        "本次沒有 Google Search 來源標記，因此顯示灰藍色 i，而不是無圖示或灰色 ↻。"
      ].filter(Boolean).join(" ");
    }

    // manual_review 至少要有 findings、原始搜尋文字或來源。
    const rawSearchText =
      status === "manual_review"
        ? buildReadableRiskSummary(
            parsed,
            answer
          )
        : "";

    if (
      status === "manual_review" &&
      findings.length === 0 &&
      !rawSearchText &&
      grounding.sources.length === 0
    ) {
      throw createRiskRequestError(
        "沒有取得可供人工判讀的內容。",
        {
          failureType: "network_timeout"
        }
      );
    }

    if (status === "clear") {
      severity = "none";
      summary =
        summary ||
        "搜尋已完成，未找到與本場直接相關的近期異常資訊。";
      impact = "";
    }

    if (status === "manual_review") {
      severity = "unknown";
      summary =
        summary ||
        "已找到近期資訊，請由人類自行判讀。";
      impact =
        impact ||
        "目前沒有足夠證據列為紅色風險，但資訊仍可能具有賽前參考價值。";
    }

    const match = compactRiskMatch(row);
    const checkedAt = new Date();
    const cacheHours =
      RISK_RESOLVED_CACHE_HOURS;

    return {
      match_key: match.match_key,
      item: match.item,
      date_time_taipei:
        match.date_time_taipei,
      league: match.league,
      home: match.home,
      away: match.away,
      hot_player: match.hot_player,
      rating: match.rating,
      status,
      severity,
      confidence: parsed.confidence,
      summary,
      impact,
      findings,
      // 相容舊資料與舊卡片。
      evidence: findings,
      raw_search_text:
        status === "clear"
          ? ""
          : rawSearchText,
      notes,
      sources: grounding.sources,
      web_search_queries:
        grounding.queries,
      search_completed: true,
      failure_type: null,
      http_status: 200,
      retry_after_seconds: null,
      cache_hours: cacheHours,
      cache_until: new Date(
        checkedAt.getTime() +
        cacheHours * 3600000
      ).toISOString(),
      used_cache: false,
      checked_at:
        checkedAt.toISOString(),
      model,
      retry_count:
        response.retryCount +
        repairRetryCount,
      request_bytes:
        response.requestBytes +
        repairRequestBytes
    };
  }

  async function scanExternalRisks(rows, options = {}) {
    const nowMs = Date.now();
    const eligibleRows = (
      Array.isArray(rows) ? rows : []
    )
      .filter(row => isExternalRiskEligible(row, nowMs))
      .sort((left, right) => {
        const ratingOrder = { A: 0, B: 1 };
        const ratingDiff =
          (ratingOrder[left?.["評級"]] ?? 9) -
          (ratingOrder[right?.["評級"]] ?? 9);
        if (ratingDiff) return ratingDiff;
        return String(left?.["日期時間"] || "")
          .localeCompare(String(right?.["日期時間"] || ""));
      });

    const existingEntries = Array.isArray(
      options.existingEntries
    ) ? options.existingEntries : [];
    const existingMap = new Map(
      existingEntries.map(entry => [
        String(entry?.match_key || ""), entry
      ])
    );

    const entries = [];
    let completed = 0;
    let scanned = 0;
    let cached = 0;

    for (const row of eligibleRows) {
      const key = externalRiskMatchKey(row);
      const oldEntry = existingMap.get(key);

      if (isRiskCacheFresh(oldEntry, row, nowMs)) {
        const cachedEntry = {
          ...oldEntry,
          used_cache: true,
          last_used_at:
            new Date().toISOString()
        };

        entries.push(cachedEntry);
        cached += 1;
        completed += 1;

        if (typeof options.onProgress === "function") {
          options.onProgress({
            completed,
            total: eligibleRows.length,
            scanned,
            cached,
            row,
            entry: cachedEntry,
            fromCache: true
          });
        }
        continue;
      }

      if (typeof options.onPending === "function") {
        await options.onPending(row, {
          completed,
          total: eligibleRows.length
        });
      }

      let entry;
      try {
        entry = await scanExternalRisk(row, options);
      } catch (error) {
        const match = compactRiskMatch(row);
        const friendly = friendlyRiskFailure(error);

        entry = {
          match_key: match.match_key,
          item: match.item,
          date_time_taipei: match.date_time_taipei,
          league: match.league,
          home: match.home,
          away: match.away,
          hot_player: match.hot_player,
          rating: match.rating,
          status: friendly.public_status,
          severity: "unknown",
          confidence: 0,
          summary: friendly.summary,
          impact: friendly.impact,
          evidence: [],
          notes: friendly.notes,
          search_completed: false,
          failure_type:
            friendly.failure_type,
          http_status:
            friendly.http_status,
          retry_after_seconds:
            friendly.retry_after_seconds,
          cache_hours: 0,
          cache_until: null,
          used_cache: false,
          technical_error:
            friendly.technical_error,
          sources: [],
          web_search_queries: [],
          checked_at: new Date().toISOString(),
          model:
            String(options.model || DEFAULT_MODEL),
          retry_count: 0,
          request_bytes: 0
        };
      }

      entries.push(entry);
      scanned += 1;
      completed += 1;

      if (typeof options.onEntry === "function") {
        await options.onEntry(entry, {
          completed,
          total: eligibleRows.length,
          scanned,
          cached,
          row,
          fromCache: false
        });
      }

      if (typeof options.onProgress === "function") {
        options.onProgress({
          completed,
          total: eligibleRows.length,
          scanned,
          cached,
          row,
          entry,
          fromCache: false
        });
      }

      if (entry.status === "system_error") {
        const remainingRows =
          eligibleRows.slice(completed);

        for (const remainingRow of remainingRows) {
          const match =
            compactRiskMatch(remainingRow);
          const stoppedEntry = {
            match_key: match.match_key,
            item: match.item,
            date_time_taipei:
              match.date_time_taipei,
            league: match.league,
            home: match.home,
            away: match.away,
            hot_player: match.hot_player,
            rating: match.rating,
            status: "system_error",
            severity: "unknown",
            confidence: 0,
            summary:
              "本場尚未檢查：整批掃描已因 API Key 或權限錯誤而停止。",
            impact:
              "這不是球員風險，而是系統目前無法使用 Gemini。",
            evidence: [],
            notes:
              "修正 API Key 或權限後，重新分析即可再次檢查。",
            search_completed: false,
            failure_type: "auth_401_403",
            http_status:
              entry.http_status,
            retry_after_seconds: null,
            cache_hours: 0,
            cache_until: null,
            used_cache: false,
            technical_error:
              entry.technical_error,
            sources: [],
            web_search_queries: [],
            checked_at:
              new Date().toISOString(),
            model:
              String(
                options.model || DEFAULT_MODEL
              ),
            retry_count: 0,
            request_bytes: 0
          };

          entries.push(stoppedEntry);
          scanned += 1;
          completed += 1;

          if (
            typeof options.onEntry === "function"
          ) {
            await options.onEntry(
              stoppedEntry,
              {
                completed,
                total: eligibleRows.length,
                scanned,
                cached,
                row: remainingRow,
                fromCache: false
              }
            );
          }

          if (
            typeof options.onProgress === "function"
          ) {
            options.onProgress({
              completed,
              total: eligibleRows.length,
              scanned,
              cached,
              row: remainingRow,
              entry: stoppedEntry,
              fromCache: false
            });
          }
        }

        break;
      }

      if (
        entry.failure_type === "quota_429" &&
        completed < eligibleRows.length
      ) {
        const waitSeconds = Math.min(
          120,
          Math.max(
            1,
            Number(
              entry.retry_after_seconds || 10
            )
          )
        );
        await sleep(waitSeconds * 1000);
      } else if (
        completed < eligibleRows.length &&
        Number(
          options.delayMs ??
          RISK_SCAN_DELAY_MS
        ) > 0
      ) {
        await sleep(
          Number(
            options.delayMs ??
            RISK_SCAN_DELAY_MS
          )
        );
      }
    }

    return {
      eligibleRows,
      entries,
      completed,
      scanned,
      cached,
      resolved:
        entries.filter(item =>
          isRiskResolvedStatus(item?.status)
        ).length,
      unresolved:
        entries.filter(item =>
          isRiskFailureStatus(item?.status)
        ).length
    };
  }

  function buildSystemText(context, customSystemPrompt) {
    const contextRule = context.context_mode === "selected_matches"
      ? "只附指定場次完整資料；不得聲稱看過其他未附場次。"
      : "附全部場次精簡表，適合排行總覽；未附每場龐大巢狀資料。";
    const custom = String(customSystemPrompt || "").trim();
    return (
      DEFAULT_SYSTEM_PROMPT +
      "\nJSON是唯一主資料；不得補造賠率、勝率、評級或模型結果。\n" +
      `${contextRule}\n` +
      "Pinnacle賠率是實際分析價格；外網賠率不得取代或重算EV。\n" +
      "涉及傷病、退賽、疲勞、旅行、近期狀態與官方公告時，可用Google搜尋交叉核對，但外網只能作為獨立風險因子。\n" +
      "回答時優先列出對陣、熱門方賠率、Pinnacle去水勝率、評級勝率、評級EV、Main Tour／All Levels混合比重、D值、五項方向、EV與五項支持兩道評級門檻、資料缺口與外網查證結果。\n" +
      `目前台灣時間：${taipeiTimeText()}。\n` +
      (custom ? `\n【使用者自訂系統提示】\n${custom}\n` : "") +
      "\n【本次問題專用TennisRatio JSON】\n" +
      JSON.stringify(context)
    );
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function retrySeconds(response, detail, attempt) {
    const headerValue = String(response?.headers?.get?.("Retry-After") || "").trim();
    if (headerValue && Number.isFinite(Number(headerValue))) {
      return Math.min(Math.max(Number(headerValue), 0.5), 20);
    }
    const match = String(detail || "").match(/retry\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*s/i);
    if (match) return Math.min(Math.max(Number(match[1]) + 0.35, 0.5), 20);
    return Math.min(2 ** attempt, 12);
  }

  async function readErrorDetail(response) {
    const text = await response.text();
    try {
      const payload = JSON.parse(text);
      return String(payload?.error?.message || payload?.message || text);
    } catch {
      return text || `HTTP ${response.status}`;
    }
  }

  function generationConfigForModel(model) {
    const config = { maxOutputTokens: 4096 };
    // Gemini 3.x 新模型不接受舊式 sampling 參數；2.5 維持原本 temperature=0。
    if (!/^gemini-3(?:\.|-|$)/i.test(model)) {
      config.temperature = 0.0;
    }
    return config;
  }

  async function ask(question, options = {}) {
    const text = String(question || "").trim();
    if (!text) throw new Error("請先輸入問題。");
    if (text.length > 12000) {
      throw new Error("單次問題過長，請縮短至12000字元內。");
    }

    const analysis = options.analysis && typeof options.analysis === "object"
      ? options.analysis
      : {};
    if (!analysis.generated_at_taiwan && !Array.isArray(analysis.matches)) {
      throw new Error("TennisRatio尚未完成分析，Gemini暫不開放。");
    }

    const workerUrl = String(
      options.workerUrl || ""
    ).trim().replace(/\/+$/, "");

    if (!workerUrl.startsWith("https://")) {
      throw new Error(
        "Gemini Worker URL 必須使用 https://。"
      );
    }

    const workerToken = String(
      options.workerToken || ""
    ).trim();

    if (!workerToken) {
      throw new Error(
        "缺少 Cloudflare Worker 驗證 Token。"
      );
    }

    const model =
      String(options.model || DEFAULT_MODEL).trim() ||
      DEFAULT_MODEL;

    const rows = Array.isArray(options.rows)
      ? options.rows
      : (Array.isArray(analysis.matches) ? analysis.matches : []);
    const history = Array.isArray(options.history) ? options.history : [];
    const context = buildContext(text, {
      payload: options.payload,
      analysis,
      rows,
      revision: options.revision,
      history
    });
    const contents = [];
    for (const item of history.slice(-MAX_HISTORY_MESSAGES)) {
      if (!item || typeof item !== "object") continue;
      const role = String(item.role) === "model" ? "model" : "user";
      const value = String(item.text || item.content || "").trim();
      if (value) {
        contents.push({ role, parts: [{ text: value.slice(0, 6000) }] });
      }
    }
    contents.push({ role: "user", parts: [{ text }] });

    const requestPayload = {
      systemInstruction: {
        parts: [{
          text: buildSystemText(context, options.customSystemPrompt)
        }]
      },
      contents,
      tools: options.webGrounding === false ? [] : [{ google_search: {} }],
      generationConfig: generationConfigForModel(model)
    };
    const proxyPayload = {
      model,
      request: requestPayload
    };

    const encodedText = JSON.stringify(proxyPayload);
    const requestBytes =
      new TextEncoder().encode(encodedText).byteLength;

    const endpoint =
      `${workerUrl}${DEFAULT_WORKER_PATH}`;
    const fetchImpl = options.fetchImpl || global.fetch?.bind(global);
    if (typeof fetchImpl !== "function") {
      throw new Error("目前瀏覽器不支援 fetch。")
    }

    let responsePayload = null;
    let retryCount = 0;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json; charset=utf-8",
            "Authorization":
              `Bearer ${workerToken}`
          },
          body: encodedText,
          signal: controller.signal,
          cache: "no-store"
        });
        if (response.ok) {
          responsePayload = await response.json();
          break;
        }
        const detail = await readErrorDetail(response);
        const retryable = response.status === 429 || [500, 502, 503, 504].includes(response.status);
        if (retryable && attempt < MAX_RETRIES) {
          retryCount += 1;
          const wait = response.status === 429
            ? retrySeconds(response, detail, attempt)
            : Math.min(1.5 * (2 ** attempt), 12);
          await sleep(wait * 1000);
          continue;
        }
        if (response.status === 429) {
          throw new Error(
            "Gemini額度繁忙（HTTP 429）；已自動重試。本次只傳問題所需資料，請30～60秒後再送。"
          );
        }
        throw new Error(`Gemini Worker錯誤 HTTP ${response.status}：${detail}`);
      } catch (error) {
        const isAbort = error?.name === "AbortError";
        const retryableNetwork = isAbort || error instanceof TypeError;
        if (retryableNetwork && attempt < MAX_RETRIES) {
          retryCount += 1;
          await sleep(Math.min(1.5 * (2 ** attempt), 12) * 1000);
          continue;
        }
        if (isAbort) throw new Error("Gemini Worker連線逾時。");
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!responsePayload) throw new Error("Gemini Worker沒有回傳資料。");
    const answer = extractText(responsePayload);
    const grounding = extractGrounding(responsePayload);
    return {
      answer,
      model,
      usage: responsePayload.usageMetadata || {},
      context_revision: Number(options.revision || 0),
      context_mode: context.context_mode,
      selected_items: context.selected_items || [],
      sent_match_count: context.sent_match_count || 0,
      total_match_count: context.total_match_count || 0,
      retry_count: retryCount,
      request_bytes: requestBytes,
      web_search_used: Boolean(grounding.sources.length || grounding.queries.length),
      web_search_queries: grounding.queries,
      grounding_sources: grounding.sources
    };
  }

  global.TennisRatioGemini = Object.freeze({
    DEFAULT_MODEL,
    DEFAULT_WORKER_PATH,
    DEFAULT_SYSTEM_PROMPT,
    buildContext,
    extractText,
    extractGrounding,
    externalRiskMatchKey,
    isExternalRiskEligible,
    normalizeRiskStatus,
    isRiskResolvedStatus,
    isRiskFailureStatus,
    riskCacheHours,
    isRiskCacheFresh,
    compactRiskMatch,
    parseRiskResponse,
    friendlyRiskFailure,
    repairRiskJson,
    scanExternalRisk,
    scanExternalRisks,
    ask
  });
})(typeof window !== "undefined" ? window : globalThis);
