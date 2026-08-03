((global) => {
  "use strict";

  const DEFAULT_MODEL = "gemini-2.5-flash";
  const DEFAULT_WORKER_PATH = "/gemini";
  const MAX_HISTORY_MESSAGES = 6;
  const MAX_SELECTED_MATCHES = 4;
  const MAX_RETRIES = 3;
  const REQUEST_TIMEOUT_MS = 120000;

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
    ask
  });
})(typeof window !== "undefined" ? window : globalThis);
