((global) => {
  "use strict";

  const DEFAULT_MODEL = "gemini-2.5-flash";
  const DEFAULT_WORKER_PATH = "/gemini";
  const MAX_HISTORY_MESSAGES = 6;
  const MAX_SELECTED_MATCHES = 4;
  const MAX_RETRIES = 3;
  const REQUEST_TIMEOUT_MS = 120000;
  const RISK_SCAN_DELAY_MS = 1400;
  const RISK_CACHE_HOURS = 6;
  const RISK_NEAR_MATCH_CACHE_HOURS = 1;
  const RISK_NEAR_MATCH_WINDOW_HOURS = 2;

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

  function isFinalRiskStatus(value) {
    return [
      "risk_found",
      "clear",
      "insufficient",
      "failed"
    ].includes(String(value || ""));
  }

  function isRiskCacheFresh(entry, row, nowMs = Date.now()) {
    if (!entry || !isFinalRiskStatus(entry.status)) return false;
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

    const checkedAt = Date.parse(String(entry.checked_at || ""));
    if (!Number.isFinite(checkedAt)) return false;

    const matchTime = parseTaipeiMatchTime(row?.["日期時間"]);
    const hoursToMatch = Number.isFinite(matchTime)
      ? (matchTime - nowMs) / 3600000
      : Number.POSITIVE_INFINITY;
    const freshnessHours =
      hoursToMatch <= RISK_NEAR_MATCH_WINDOW_HOURS
        ? RISK_NEAR_MATCH_CACHE_HOURS
        : RISK_CACHE_HOURS;

    return nowMs - checkedAt <= freshnessHours * 3600000;
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
      "other"
    ]);

    const status = allowedStatus.has(String(parsed?.status))
      ? String(parsed.status)
      : "insufficient";
    const severity = allowedSeverity.has(String(parsed?.severity))
      ? String(parsed.severity)
      : (status === "clear" ? "none" : "unknown");
    const confidenceValue = Number(parsed?.confidence);
    const confidence = Number.isFinite(confidenceValue)
      ? Math.max(0, Math.min(1, confidenceValue))
      : 0;

    const evidence = (
      Array.isArray(parsed?.evidence)
        ? parsed.evidence
        : []
    )
      .slice(0, 6)
      .map(item => ({
        date:
          String(item?.date || "").trim() || null,
        category: allowedCategories.has(
          String(item?.category || "")
        )
          ? String(item.category)
          : "other",
        fact:
          String(item?.fact || "").trim().slice(0, 600),
        relevance:
          String(item?.relevance || "").trim().slice(0, 600)
      }))
      .filter(item => item.fact);

    return {
      status,
      severity,
      confidence,
      summary:
        String(parsed?.summary || "").trim().slice(0, 900),
      impact:
        String(parsed?.impact || "").trim().slice(0, 900),
      evidence,
      notes:
        String(parsed?.notes || "").trim().slice(0, 900)
    };
  }

  function buildRiskSystemText(row) {
    const match = compactRiskMatch(row);
    return (
      "你是 TennisRatio 的賽前外部風險覆核代理。全程使用繁體中文。" +
      "\n你的唯一任務：使用 Google Search 檢查本場『熱門方』是否存在結構化數據沒有反映、而且可能對本場不利的近期資訊。" +
      "\n必查範圍：近期傷病、傷退、退賽、疾病、醫療暫停、明確體能問題、前一場超長比賽、短休連戰、密集賽程、跨城市或跨洲移動、官方或選手本人確認的狀態異常。" +
      "\n紅色風險必須同時符合：有可辨識日期、有可靠來源、與目前熱門方姓名相符、與本場時間接近、合理可能影響本場。" +
      "\n不可單獨視為風險：很久以前的舊傷、單純近期輸球、排名較差、球迷猜測、無日期文章、沒有來源的社群留言、你自行推測的疲勞。" +
      "\n若查到的資訊可能是同名不同人，必須判定 insufficient。" +
      "\n若沒有找到明確不利資訊，status 必須是 clear；這只表示本次可靠搜尋未找到，不代表絕對沒有問題。" +
      "\n只輸出一個 JSON 物件，不要 Markdown、不要程式碼圍欄、不要額外解釋。" +
      '\nJSON格式：{"status":"risk_found|clear|insufficient","severity":"high|medium|none|unknown","confidence":0到1,"summary":"一句話結論","impact":"為何可能影響本場","evidence":[{"date":"YYYY-MM-DD或null","category":"injury|illness|retirement|fatigue|schedule|travel|official_status|other","fact":"可驗證事實","relevance":"與本場的直接關係"}],"notes":"必要補充"}' +
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

        throw new Error(
          `Gemini Worker錯誤 HTTP ${response.status}：${detail}`
        );
      } catch (error) {
        const isAbort = error?.name === "AbortError";
        const retryableNetwork =
          isAbort || error instanceof TypeError;
        if (
          retryableNetwork &&
          attempt < MAX_RETRIES
        ) {
          retryCount += 1;
          await sleep(
            Math.min(1.5 * (2 ** attempt), 12) * 1000
          );
          continue;
        }
        if (isAbort) {
          throw new Error("Gemini Worker連線逾時。");
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!responsePayload) {
      throw new Error("Gemini Worker沒有回傳資料。");
    }

    return {
      payload: responsePayload,
      retryCount,
      requestBytes
    };
  }

  async function scanExternalRisk(row, options = {}) {
    if (!isExternalRiskEligible(row)) {
      throw new Error("此場不符合 A／B 外部風險掃描條件。");
    }

    const model =
      String(options.model || DEFAULT_MODEL).trim() ||
      DEFAULT_MODEL;

    const requestPayload = {
      systemInstruction: {
        parts: [{ text: buildRiskSystemText(row) }]
      },
      contents: [{
        role: "user",
        parts: [{
          text:
            "請立即使用 Google Search 完成本場熱門方外部風險覆核，並依指定格式只輸出 JSON。"
        }]
      }],
      tools: [{ google_search: {} }],
      generationConfig: {
        ...generationConfigForModel(model),
        maxOutputTokens: 1800
      }
    };

    const response = await postRiskProxy({
      model,
      request: requestPayload
    }, options);

    const answer = extractText(response.payload);
    const grounding = extractGrounding(response.payload);
    const parsed = parseRiskResponse(answer);

    let status = parsed.status;
    let severity = parsed.severity;
    let summary = parsed.summary;
    let impact = parsed.impact;
    let notes = parsed.notes;

    if (
      status === "risk_found" &&
      (
        parsed.confidence < 0.72 ||
        parsed.evidence.length === 0 ||
        !parsed.evidence.some(item =>
          /^\d{4}-\d{2}-\d{2}$/.test(
            String(item?.date || "")
          )
        ) ||
        !parsed.summary ||
        !parsed.impact ||
        grounding.sources.length === 0
      )
    ) {
      status = "insufficient";
      severity = "unknown";
      notes = [
        notes,
        "模型提出風險，但未同時通過可信度、具體證據與來源門檻，因此不顯示紅色警示。"
      ].filter(Boolean).join(" ");
    }

    if (
      status === "clear" &&
      grounding.sources.length === 0 &&
      grounding.queries.length === 0
    ) {
      status = "insufficient";
      severity = "unknown";
      summary =
        "Gemini 沒有留下 Google Search 查證紀錄，不能把本場視為已完成安全掃描。";
      notes = [
        notes,
        "clear 必須至少有搜尋詞或 grounding 來源。"
      ].filter(Boolean).join(" ");
    }

    if (status === "clear") {
      severity = "none";
      if (!summary) {
        summary =
          "本次可靠搜尋未找到與本場直接相關的明確不利資訊。";
      }
      impact = "";
    }

    if (status === "insufficient" && !summary) {
      summary =
        "目前資料不足，無法可靠確認熱門方是否存在外部風險。";
    }

    const match = compactRiskMatch(row);
    return {
      match_key: match.match_key,
      item: match.item,
      date_time_taipei: match.date_time_taipei,
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
      evidence: parsed.evidence,
      notes,
      sources: grounding.sources,
      web_search_queries: grounding.queries,
      checked_at: new Date().toISOString(),
      model,
      retry_count: response.retryCount,
      request_bytes: response.requestBytes
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
        entries.push(oldEntry);
        cached += 1;
        completed += 1;
        if (typeof options.onProgress === "function") {
          options.onProgress({
            completed,
            total: eligibleRows.length,
            scanned,
            cached,
            row,
            entry: oldEntry,
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
        entry = {
          match_key: match.match_key,
          item: match.item,
          date_time_taipei: match.date_time_taipei,
          league: match.league,
          home: match.home,
          away: match.away,
          hot_player: match.hot_player,
          rating: match.rating,
          status: "failed",
          severity: "unknown",
          confidence: 0,
          summary:
            "外部風險搜尋失敗，不能把空白視為已確認安全。",
          impact: "",
          evidence: [],
          notes: error?.message || String(error),
          sources: [],
          web_search_queries: [],
          checked_at: new Date().toISOString(),
          model: String(options.model || DEFAULT_MODEL),
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

      if (
        completed < eligibleRows.length &&
        Number(options.delayMs ?? RISK_SCAN_DELAY_MS) > 0
      ) {
        await sleep(Number(options.delayMs ?? RISK_SCAN_DELAY_MS));
      }
    }

    return {
      eligibleRows,
      entries,
      completed,
      scanned,
      cached
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
    isRiskCacheFresh,
    compactRiskMatch,
    parseRiskResponse,
    scanExternalRisk,
    scanExternalRisks,
    ask
  });
})(typeof window !== "undefined" ? window : globalThis);
