((global) => {
  "use strict";

  const DEFAULT_MODEL = "groq/compound";
  const RISK_MODEL = "groq/compound-mini";
  const RISK_MAX_COMPLETION_TOKENS = 1600;
  const RISK_MINIMAL_COMPLETION_TOKENS = 900;
  const DEFAULT_WORKER_PATH = "/groq";
  const MAX_HISTORY_MESSAGES = 4;
  const MAX_HISTORY_CHARS = 1200;
  const MAX_SELECTED_MATCHES = 3;
  const MAX_OVERVIEW_MATCHES = 80;
  const MAX_REQUEST_BYTES = 24000;
  const MAX_RETRIES = 3;
  const REQUEST_TIMEOUT_MS = 120000;
  const RISK_SCAN_DELAY_MS = 1400;
  const RISK_RESOLVED_CACHE_HOURS = 6;

  const DEFAULT_SYSTEM_PROMPT =
    "你是 TennisRatio 網球賽事分析助理。全程使用繁體中文，回答清楚、精確、可覆盤。" +
    "以系統附上的 Pinnacle 與 ratio_analysis.json 資料為主，不得捏造賠率、勝率、評級、D值或五項比較。" +
    "先區分市場定義、機械評級與外網查證；外網資料只能作為傷病、賽程、旅行、近期狀態與官方消息的補充。" +
    "若使用 Groq Compound 內建 Web Search，回答結尾列出資料來源；找不到可靠資料要明說。" +
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
    const text =
      String(question || "")
        .toLocaleLowerCase("zh-Hant");

    const keywords = [
      "全部", "整體", "所有", "哪幾場", "哪些場",
      "最高", "最低", "排行", "排名", "前三",
      "前3", "前五", "前5", "整理abc",
      "比較各場", "比較全部", "總覽", "清單",
      "幾場", "多少場", "幾個", "多少個",
      "評級分布", "評級數量"
    ];

    return keywords.some(
      keyword => text.includes(keyword)
    );
  }

  function ratingAggregateQuestion(question) {
    const text =
      String(question || "")
        .replace(/\s+/g, "")
        .toUpperCase();

    const countWords =
      /(幾場|多少場|幾個|多少個|數量|分布|統計|目前有)/u;
    const ratingWords =
      /(A級|B級|C級|淘汰|冷門方|過期|資料不足|場地待補|層級待補|評級)/u;

    return (
      countWords.test(text) &&
      ratingWords.test(text)
    );
  }

  function ratingCountSummary(rows) {
    const all = {};
    const active = {};

    for (
      const row of
      Array.isArray(rows) ? rows : []
    ) {
      const rating =
        String(row?.評級 || "未分類").trim() ||
        "未分類";

      all[rating] = (all[rating] || 0) + 1;

      if (!Boolean(row?.已過期)) {
        active[rating] =
          (active[rating] || 0) + 1;
      }
    }

    return {
      全部場次: all,
      未過期場次: active
    };
  }

  function compactOverviewRow(row) {
    const model =
      row?.模型 &&
      typeof row.模型 === "object"
        ? row.模型
        : {};

    const hotFive =
      model?.熱門方五項較優數;
    const totalFive =
      model?.五項比較數;

    return {
      項: row?.項次 ?? null,
      時: row?.日期時間 ?? null,
      聯: row?.聯賽 ?? null,
      主: row?.主場 ?? null,
      客: row?.客場 ?? null,
      熱: row?.熱門方 ?? null,
      賠: row?.熱門方賠率 ?? null,
      市率:
        row?.Pinnacle去水勝率 ?? null,
      評率:
        row?.評級勝率 ?? null,
      EV:
        row?.評級EV百分比 ??
        row?.["公式B EV百分比"] ??
        null,
      級: row?.評級 ?? null,
      D: model?.D數據差 ?? null,
      五:
        hotFive == null &&
        totalFive == null
          ? null
          : `${hotFive ?? 0}/${totalFive ?? 0}`,
      M: model?.Main權重 ?? null,
      A:
        model?.["All Levels權重"] ??
        null,
      期:
        Boolean(row?.已過期)
    };
  }

  function compactFiveItems(row) {
    const source =
      row?.評級五項比較?.項目;

    if (!Array.isArray(source)) return [];

    return source.slice(0, 5).map(item => ({
      名稱:
        item?.名稱 ||
        item?.label ||
        item?.key ||
        null,
      熱門方值:
        item?.熱門方值 ?? null,
      對手值:
        item?.對手值 ?? null,
      差值:
        item?.差值 ?? null,
      較優方:
        item?.較優方 ?? null
    }));
  }

  function compactBreadth(row, key) {
    const group =
      row?.原始指標比較?.[key];

    if (!group || typeof group !== "object") {
      return null;
    }

    return {
      樣本:
        group?.樣本 ?? null,
      統計:
        group?.統計 ?? null
    };
  }

  function compactSelectedRow(row) {
    const event =
      row?.比賽資訊 &&
      typeof row.比賽資訊 === "object"
        ? row.比賽資訊
        : {};
    const model =
      row?.模型 &&
      typeof row.模型 === "object"
        ? row.模型
        : {};
    const decision =
      row?.評級判定 &&
      typeof row.評級判定 === "object"
        ? row.評級判定
        : {};
    const bo3 =
      row?.BO3機械預測 &&
      typeof row.BO3機械預測 === "object"
        ? row.BO3機械預測
        : {};

    return {
      基本資料: {
        項次: row?.項次 ?? null,
        日期時間:
          row?.日期時間 ?? null,
        聯賽: row?.聯賽 ?? null,
        層級:
          event?.tournament_level ??
          null,
        輪次:
          event?.round_name ?? null,
        場地:
          event?.surface ?? null,
        主場: row?.主場 ?? null,
        客場: row?.客場 ?? null,
        主場名次:
          row?.主場名次 ?? null,
        客場名次:
          row?.客場名次 ?? null
      },
      市場資料: {
        主場賠率:
          row?.主場賠率 ?? null,
        客場賠率:
          row?.客場賠率 ?? null,
        熱門方:
          row?.熱門方 ?? null,
        熱門方位置:
          row?.熱門方位置 ?? null,
        熱門方賠率:
          row?.熱門方賠率 ?? null,
        賠轉勝率:
          row?.賠轉勝率 ?? null,
        Pinnacle去水勝率:
          row?.Pinnacle去水勝率 ?? null
      },
      評級結果: {
        評級:
          row?.評級 ?? null,
        評級勝率:
          row?.評級勝率 ?? null,
        評級EV百分比:
          row?.評級EV百分比 ??
          row?.["公式B EV百分比"] ??
          null,
        公式B狀態:
          row?.公式B狀態 ?? null,
        判定原因:
          row?.判定原因 ?? null,
        分析狀態:
          row?.分析狀態 ?? null,
        已過期:
          Boolean(row?.已過期),
        降級原因:
          decision?.降級原因 ?? null
      },
      模型摘要: {
        Main權重:
          model?.Main權重 ?? null,
        AllLevels權重:
          model?.["All Levels權重"] ??
          null,
        賽事Main係數:
          model?.賽事Main係數 ?? null,
        Main樣本可信度:
          model?.Main樣本可信度 ?? null,
        數據使用模式:
          model?.數據使用模式 ?? null,
        D值:
          model?.D數據差 ?? null,
        排名情境:
          model?.排名情境 ?? null,
        排名情境說明:
          model?.排名情境說明 ?? null,
        實際排名修正:
          model?.實際排名修正 ?? null,
        五項支持:
          model?.熱門方五項較優數 ??
          null,
        五項比較數:
          model?.五項比較數 ?? null
      },
      五項比較:
        compactFiveItems(row),
      十五項廣度: {
        AllLevels:
          compactBreadth(
            row,
            "All Levels｜同場地"
          ),
        MainTour:
          compactBreadth(
            row,
            "Main Tour｜同場地"
          )
      },
      BO3摘要: {
        狀態: bo3?.狀態 ?? null,
        預估總局數:
          bo3?.預估總局數 ?? null,
        熱門方預測:
          bo3?.熱門方預測 ?? null,
        對手預測:
          bo3?.對手預測 ?? null,
        盤數機率:
          bo3?.盤數機率 ?? null
      }
    };
  }

  function buildContext(question, options = {}) {
    const payload =
      options.payload &&
      typeof options.payload === "object"
        ? options.payload
        : {};
    const analysis =
      options.analysis &&
      typeof options.analysis === "object"
        ? options.analysis
        : {};
    const rows =
      Array.isArray(options.rows)
        ? options.rows
        : (
            Array.isArray(
              analysis.matches
            )
              ? analysis.matches
              : []
          );
    const history =
      Array.isArray(options.history)
        ? options.history
        : [];
    const revision =
      Number(options.revision || 0);

    const base = {
      context_schema:
        "tennisratio-question-context-v4-compact",
      revision,
      batch_date:
        payload.batch_date ?? null,
      pinnacle_query_time:
        payload.query_time ?? null,
      ratio_generated_at_taiwan:
        analysis.generated_at_taiwan ??
        null,
      total_match_count:
        rows.length
    };

    if (ratingAggregateQuestion(question)) {
      return {
        ...base,
        context_mode:
          "rating_summary",
        sent_match_count: 0,
        rating_counts:
          ratingCountSummary(rows),
        note:
          "此問題只需要評級數量，不傳送逐場完整資料。"
      };
    }

    let selectedItems = unique([
      ...explicitItemMentions(question),
      ...fullNameMentions(
        question,
        rows
      )
    ]);
    let selectionSource =
      selectedItems.length
        ? "current_question"
        : "";

    if (
      !selectedItems.length &&
      !overviewQuestion(question)
    ) {
      for (
        const item of
        history
          .slice(-MAX_HISTORY_MESSAGES)
          .reverse()
      ) {
        if (
          !item ||
          typeof item !== "object"
        ) {
          continue;
        }

        const historyText =
          String(
            item.text ||
            item.content ||
            ""
          );
        const references = unique([
          ...explicitItemMentions(
            historyText
          ),
          ...fullNameMentions(
            historyText,
            rows
          )
        ]);

        if (references.length) {
          selectedItems = references;
          selectionSource =
            "conversation_history";
          break;
        }
      }
    }

    const validItems = new Set(
      rows
        .map(row =>
          itemNumber(row?.項次)
        )
        .filter(value =>
          value !== null
        )
    );

    selectedItems = selectedItems
      .filter(item =>
        validItems.has(item)
      )
      .slice(
        0,
        MAX_SELECTED_MATCHES
      );

    if (selectedItems.length) {
      const selectedSet =
        new Set(selectedItems);
      const selectedRows =
        rows
          .filter(row =>
            selectedSet.has(
              itemNumber(row?.項次)
            )
          )
          .map(compactSelectedRow);

      return {
        ...base,
        context_mode:
          "selected_matches_compact",
        selection_source:
          selectionSource,
        selected_items:
          selectedItems,
        sent_match_count:
          selectedRows.length,
        selected_matches:
          selectedRows,
        note:
          "只傳指定場次的必要評級、模型與比較摘要，不重複傳送完整巢狀JSON。"
      };
    }

    const overviewRows =
      rows
        .slice(
          0,
          MAX_OVERVIEW_MATCHES
        )
        .map(compactOverviewRow);

    return {
      ...base,
      context_mode:
        "compact_overview",
      selection_source:
        "overview_or_unresolved",
      selected_items: [],
      sent_match_count:
        overviewRows.length,
      table_rows_compact:
        overviewRows,
      rows_omitted:
        Math.max(
          0,
          rows.length -
          overviewRows.length
        ),
      rating_counts:
        ratingCountSummary(rows),
      note:
        "跨場問題只傳超精簡表；不傳每場巢狀資料、完整十五項或完整球員統計。"
    };
  }

  function extractText(payload) {
    const message =
      payload?.choices?.[0]?.message || {};
    const content = message?.content;

    if (
      typeof content === "string" &&
      content.trim()
    ) {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const joined = content
        .map(item =>
          typeof item === "string"
            ? item
            : String(item?.text || "")
        )
        .filter(Boolean)
        .join("\n")
        .trim();

      if (joined) return joined;
    }

    const finishReason =
      payload?.choices?.[0]?.finish_reason;

    if (finishReason) {
      throw new Error(
        `Groq Compound 回應中沒有可顯示文字：${finishReason}`
      );
    }

    throw new Error(
      "Groq Compound 回應中沒有可顯示文字。"
    );
  }

  function extractGrounding(payload) {
    const message =
      payload?.choices?.[0]?.message || {};
    const content = String(
      message?.content || ""
    );

    const sources = [];
    const queries = [];
    const seenUrls = new Set();

    function addQuery(value) {
      const text = String(value || "").trim();
      if (text && !queries.includes(text)) {
        queries.push(text);
      }
    }

    function cleanUrl(value) {
      return String(value || "")
        .trim()
        .replace(/[),.;\]}>"']+$/g, "");
    }

    function addSource(title, uri) {
      const url = cleanUrl(uri);

      if (
        !/^https?:\/\//i.test(url) ||
        seenUrls.has(url)
      ) {
        return;
      }

      seenUrls.add(url);
      sources.push({
        title:
          String(title || url).trim() ||
          url,
        uri: url
      });
    }

    // Groq Compound citations are commonly embedded in the answer.
    for (const match of content.matchAll(
      /\[([^\]]{1,180})\]\((https?:\/\/[^)\s]+)\)/g
    )) {
      addSource(match[1], match[2]);
    }

    for (const match of content.matchAll(
      /https?:\/\/[^\s<>"'`]+/g
    )) {
      addSource("網頁來源", match[0]);
    }

    const citations = [
      ...(Array.isArray(payload?.citations)
        ? payload.citations
        : []),
      ...(Array.isArray(message?.citations)
        ? message.citations
        : [])
    ];

    for (const citation of citations) {
      addSource(
        citation?.title ||
        citation?.name ||
        citation?.url,
        citation?.url ||
        citation?.uri
      );
    }

    const executedTools =
      Array.isArray(message?.executed_tools)
        ? message.executed_tools
        : [];

    for (const tool of executedTools) {
      const type = String(
        tool?.type || ""
      );
      const argsText = String(
        tool?.arguments || ""
      ).trim();

      if (argsText) {
        try {
          const args = JSON.parse(argsText);
          addQuery(
            args?.query ||
            args?.q ||
            args?.url
          );
        } catch {
          addQuery(argsText);
        }
      }

      const output =
        typeof tool?.output === "string"
          ? tool.output
          : JSON.stringify(
              tool?.output || ""
            );

      for (const match of output.matchAll(
        /https?:\/\/[^\s<>"'`]+/g
      )) {
        addSource(
          type === "visit_website"
            ? "瀏覽來源"
            : "搜尋來源",
          match[0]
        );
      }

      const lines = output.split(/\r?\n/);

      for (
        let index = 0;
        index < lines.length;
        index += 1
      ) {
        const urlMatch =
          lines[index].match(
            /(?:URL|Link|Source)\s*:\s*(https?:\/\/\S+)/i
          );

        if (!urlMatch) continue;

        const titleMatch =
          lines[
            Math.max(0, index - 1)
          ]?.match(
            /Title\s*:\s*(.+)$/i
          );

        addSource(
          titleMatch?.[1] ||
          "搜尋來源",
          urlMatch[1]
        );
      }
    }

    return {
      sources: sources.slice(0, 12),
      queries: queries.slice(0, 12),
      executed_tools: executedTools
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
      throw new Error("Groq 外部風險回覆不是 JSON。");
    }
    return candidate.slice(start, end + 1);
  }

  function parseRiskResponse(text) {
    let parsed;
    try {
      parsed = JSON.parse(stripJsonFence(text));
    } catch (error) {
      throw new Error(
        `Groq 外部風險 JSON 解析失敗：${error.message}`
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
      .slice(0, 5)
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
      requestBytes = 0,
      cause = null
    } = {}
  ) {
    const error = new Error(message);
    error.failureType = failureType;
    error.httpStatus = httpStatus;
    error.retryAfterSeconds = retryAfterSeconds;
    error.requestBytes =
      Number(requestBytes) || 0;
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
        lower.includes("413") ||
        lower.includes(
          "request entity too large"
        )
      ) {
        failureType = "request_413";
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
          "外部風險掃描暫停：Groq API Key 或權限驗證失敗。",
        impact:
          "這是系統設定問題，不是任何一位球員的風險。",
        notes:
          "請檢查 Cloudflare Worker 的 GROQ_API_KEY、UPLOAD_TOKEN 與權限設定。",
        http_status:
          Number(error?.httpStatus) || null,
        retry_after_seconds: null,
        technical_error: technicalError
      };
    }

    if (failureType === "request_413") {
      return {
        public_status: "search_incomplete",
        failure_type: "request_413",
        summary:
          "本場的 Groq 網頁搜尋內容在服務內部膨脹，精簡重試後仍未完成。",
        impact:
          "這不是球員風險，也不是 ratio_analysis 資料過大；只是這次外部搜尋沒有完成。",
        notes:
          "系統已改用 Compound Mini 單次搜尋。灰色 ↻ 代表下次按「分析風險」會再試。",
        http_status:
          Number(error?.httpStatus) || 413,
        retry_after_seconds: null,
        technical_error: technicalError
      };
    }

    if (failureType === "quota_429") {
      return {
        public_status: "search_incomplete",
        failure_type: "quota_429",
        summary:
          "本場搜尋尚未完成：Groq 暫時達到使用上限。",
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
    const model = RISK_MODEL;

    const repairPayload = {
      messages: [
        {
          role: "system",
          content:
            "你是 JSON 格式修復器。請把使用者提供的外部風險分析文字整理成指定 JSON。" +
            "不得新增原文沒有的事實、日期、來源或風險。只輸出 JSON，不要 Markdown。" +
            '格式：{"status":"risk_found|clear|manual_review","severity":"high|medium|none|unknown","confidence":0到1,"summary":"一句話結論","impact":"與本場的可能影響","findings":[{"date":"YYYY-MM-DD或null","category":"injury|illness|retirement|fatigue|schedule|travel|official_status|training|form|neutral|other","title":"簡短標題","fact":"找到的事實","relevance":"與本場的可能關係","direction":"negative|neutral|positive"}],"notes":"必要補充","raw_summary":"原始資訊摘要"}'
        },
        {
          role: "user",
          content:
            "請只修復格式，不得改寫或補充事實：\n\n" +
            String(rawAnswer || "")
              .slice(0, 12000)
        }
      ],
      response_format: {
        type: "json_object"
      },
      max_completion_tokens: 900
    };

    const response =
      await postRiskProxy(
        {
          model,
          request: repairPayload
        },
        options
      );

    return {
      parsed: parseRiskResponse(
        extractText(response.payload)
      ),
      retryCount:
        response.retryCount,
      requestBytes:
        response.requestBytes
    };
  }

  function buildRiskSystemText(
    row,
    {
      minimal = false
    } = {}
  ) {
    const match = compactRiskMatch(row);
    const player =
      String(match.hot_player || "");
    const matchDate =
      String(match.date_time_taipei || "");
    const opponent =
      match.hot_side === "主場"
        ? match.away
        : match.home;

    if (minimal) {
      return (
        "使用一次 Web Search，查網球選手 " +
        `${player} 在本場 ${matchDate} 對 ${opponent} 前90天內，` +
        "是否有傷病、退賽、疾病、醫療暫停、上一場超長比賽、短休或官方狀態消息。" +
        "最多保留3項。不得推測旅行疲勞，不得把多年以前舊病直接當成本場風險。" +
        "只輸出JSON：" +
        '{"status":"risk_found|clear|manual_review","severity":"high|medium|none|unknown",' +
        '"confidence":0到1,"summary":"結論","impact":"本場可能影響",' +
        '"findings":[{"date":"YYYY-MM-DD或null","category":"injury|illness|retirement|fatigue|schedule|official_status|form|other",' +
        '"title":"事件","fact":"來源支持的事實","relevance":"與本場關係","direction":"negative|neutral|positive"}],' +
        '"notes":"限制","raw_summary":"簡短整理"}'
      );
    }

    return (
      "你是 TennisRatio 的賽前外部消息覆核員。使用 Groq Compound Mini，僅做一次 Web Search。" +
      `\n目標球員：${player}` +
      `\n本場：${matchDate}｜${match.league || ""}｜對手 ${opponent || ""}` +
      "\n只查本場前90天內的：傷病、退賽、疾病、醫療暫停、上一場耗時過長、短休連戰、官方狀態與明確近期低迷原因。" +
      "\n最多保留4項最有用資訊。不要搜尋生涯故事、一般心理訪談、沒有日期的傳聞或與本場無關的舊聞。" +
      "\n超過180天的舊傷或慢性疾病，除非90天內可靠來源明確證實仍在影響，否則不得列為風險。" +
      "\n不得僅因比賽位於不同國家就自行推測旅行或時差風險。" +
      "\n每項 fact 必須是來源直接支持的事實；推論只能寫在 relevance。" +
      "\n若有具體資訊但風險不明，status=manual_review；搜尋完成且沒有近期異常才可 clear。" +
      "\n只輸出一個JSON物件，不要Markdown。" +
      '\n格式：{"status":"risk_found|clear|manual_review","severity":"high|medium|none|unknown","confidence":0到1,' +
      '"summary":"一句話結論","impact":"與本場的可能影響",' +
      '"findings":[{"date":"YYYY-MM-DD或null","category":"injury|illness|retirement|fatigue|schedule|official_status|form|other",' +
      '"title":"簡短事件","fact":"來源支持的事實","relevance":"與本場關係","direction":"negative|neutral|positive"}],' +
      '"notes":"資料限制","raw_summary":"可閱讀摘要"}' +
      `\n台灣時間：${taipeiTimeText()}` +
      "\n比賽資料：" +
      JSON.stringify(match)
    );
  }

  function buildRiskRequestPayload(
    row,
    {
      minimal = false
    } = {}
  ) {
    const messages = minimal
      ? [{
          role: "user",
          content:
            buildRiskSystemText(
              row,
              { minimal: true }
            )
        }]
      : [
          {
            role: "system",
            content:
              buildRiskSystemText(row)
          },
          {
            role: "user",
            content:
              "請執行一次近期網頁搜尋並依格式回覆。"
          }
        ];

    return {
      messages,
      response_format: {
        type: "json_object"
      },
      max_completion_tokens:
        minimal
          ? RISK_MINIMAL_COMPLETION_TOKENS
          : RISK_MAX_COMPLETION_TOKENS,
      compound_custom: {
        tools: {
          enabled_tools: [
            "web_search"
          ]
        }
      }
    };
  }

  async function postRiskProxy(
    proxyPayload,
    options = {}
  ) {
    const workerUrl = String(
      options.workerUrl || ""
    ).trim().replace(/\/+$/, "");
    const workerToken = String(
      options.workerToken || ""
    ).trim();

    if (!workerUrl.startsWith("https://")) {
      throw new Error(
        "Groq Worker URL 必須使用 https://。"
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
      options.fetchImpl ||
      global.fetch?.bind(global);

    if (typeof fetchImpl !== "function") {
      throw new Error(
        "目前瀏覽器不支援 fetch。"
      );
    }

    let encodedText =
      JSON.stringify(proxyPayload);
    let requestBytes =
      new TextEncoder()
        .encode(encodedText)
        .byteLength;

    while (
      requestBytes > MAX_REQUEST_BYTES &&
      proxyPayload.request.messages.length > 2
    ) {
      proxyPayload.request.messages.splice(
        1,
        1
      );
      encodedText =
        JSON.stringify(proxyPayload);
      requestBytes =
        new TextEncoder()
          .encode(encodedText)
          .byteLength;
    }

    if (
      requestBytes > MAX_REQUEST_BYTES
    ) {
      throw new Error(
        `本次 TennisRatio 資料包仍過大（${requestBytes} bytes）；請指定項次或球員，避免詢問全部完整資料。`
      );
    }

    let responsePayload = null;
    let actualModel = DEFAULT_MODEL;
    let retryCount = 0;

    for (
      let attempt = 0;
      attempt <= MAX_RETRIES;
      attempt += 1
    ) {
      const controller =
        new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
      );

      try {
        const response =
          await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json; charset=utf-8",
              Authorization:
                `Bearer ${workerToken}`
            },
            body: encodedText,
            signal: controller.signal,
            cache: "no-store"
          });

        if (response.ok) {
          actualModel =
            response.headers.get(
              "X-TennisRatio-Groq-Model"
            ) ||
            DEFAULT_MODEL;
          responsePayload =
            await response.json();
          break;
        }

        const detail =
          await readErrorDetail(response);
        const retryable =
          response.status === 429 ||
          [500, 502, 503, 504].includes(
            response.status
          );

        if (
          retryable &&
          attempt < MAX_RETRIES
        ) {
          retryCount += 1;
          const wait =
            response.status === 429
              ? retrySeconds(
                  response,
                  detail,
                  attempt
                )
              : Math.min(
                  1.5 * (2 ** attempt),
                  12
                );
          await sleep(wait * 1000);
          continue;
        }

        if ([401, 403].includes(response.status)) {
          throw createRiskRequestError(
            `Groq Worker錯誤 HTTP ${response.status}：${detail}`,
            {
              failureType:
                "auth_401_403",
              httpStatus:
                response.status,
              requestBytes
            }
          );
        }

        if (response.status === 413) {
          throw createRiskRequestError(
            `Groq Worker錯誤 HTTP 413：${detail}`,
            {
              failureType:
                "request_413",
              httpStatus: 413,
              requestBytes
            }
          );
        }

        if (response.status === 429) {
          throw createRiskRequestError(
            `Groq Worker錯誤 HTTP 429：${detail}`,
            {
              failureType:
                "quota_429",
              httpStatus: 429,
              retryAfterSeconds:
                retrySeconds(
                  response,
                  detail,
                  attempt
                ),
              requestBytes
            }
          );
        }

        throw createRiskRequestError(
          `Groq Worker錯誤 HTTP ${response.status}：${detail}`,
          {
            failureType:
              "network_timeout",
            httpStatus:
              response.status,
            requestBytes
          }
        );
      } catch (error) {
        if (error?.failureType) {
          throw error;
        }

        const isAbort =
          error?.name === "AbortError";
        const retryableNetwork =
          isAbort ||
          error instanceof TypeError;

        if (
          retryableNetwork &&
          attempt < MAX_RETRIES
        ) {
          retryCount += 1;
          await sleep(
            Math.min(
              1.5 * (2 ** attempt),
              12
            ) * 1000
          );
          continue;
        }

        if (
          isAbort ||
          error instanceof TypeError
        ) {
          throw createRiskRequestError(
            isAbort
              ? "Groq Worker連線逾時。"
              : "Groq Worker網路連線失敗。",
            {
              failureType:
                "network_timeout",
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
        "Groq Worker沒有回傳資料。",
        {
          failureType:
            "network_timeout"
        }
      );
    }

    return {
      payload: responsePayload,
      actualModel,
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

    const model = RISK_MODEL;
    let response;
    let searchMode =
      "compound_mini_single_search";

    try {
      response =
        await postRiskProxy(
          {
            model,
            request:
              buildRiskRequestPayload(
                row
              )
          },
          options
        );
    } catch (error) {
      if (
        error?.failureType !==
          "request_413" &&
        Number(error?.httpStatus) !== 413
      ) {
        throw error;
      }

      searchMode =
        "compound_mini_minimal_retry";

      response =
        await postRiskProxy(
          {
            model,
            request:
              buildRiskRequestPayload(
                row,
                { minimal: true }
              )
          },
          options
        );
    }

    const answer =
      extractText(response.payload);
    const grounding =
      extractGrounding(
        response.payload
      );

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

        // 只要 Groq Compound 已經回覆任何可閱讀文字，就不得改成
        // search_incomplete。即使沒有 grounding 來源，也要保留
        // 回覆並交給人類自行判讀。
        if (String(answer || "").trim()) {
          const hasGrounding = Boolean(
            grounding.sources.length ||
            grounding.queries.length ||
            grounding.executed_tools.length
          );

          parsed = {
            status: "manual_review",
            severity: "unknown",
            confidence: hasGrounding ? 0.35 : 0.2,
            summary: hasGrounding
              ? "已找到外部資訊，請由人類自行判讀。"
              : "Groq Compound 已提供近期資訊，但沒有附上可核對來源。",
            impact: hasGrounding
              ? "系統無法可靠判定這些資訊是否足以構成明確風險，但搜尋內容已完整保留。"
              : "系統不會把這場列為已確認安全；回覆內容仍完整保留，請自行判斷參考價值。",
            findings: [],
            evidence: [],
            notes: hasGrounding
              ? "以下保留 Groq Compound 本次搜尋整理與來源。沒有列為紅色風險，不等於資訊沒有參考價值。"
              : "這次有取得 Groq 回覆，但沒有 Groq Web Search 來源，因此改列人工判讀，而不是搜尋未完成。",
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
        (
          grounding.sources.length === 0 &&
          grounding.queries.length === 0 &&
          grounding.executed_tools.length === 0
        )
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

    // Groq Compound 會自行判斷是否啟用內建 Web Search。
    // 若它有回覆 clear，但沒有 grounding 來源，不能標成
    // 「已確認安全」，也不能誤判成搜尋失敗；改成人工判讀，
    // 並把回覆文字完整保留。
    if (
      status === "clear" &&
      grounding.sources.length === 0 &&
      grounding.queries.length === 0 &&
      grounding.executed_tools.length === 0
    ) {
      status = "manual_review";
      severity = "unknown";
      summary =
        "Groq Compound 回覆未發現明確風險，但沒有附上可核對來源。";
      impact =
        "這場不能列為已確認安全；請閱讀 Groq 回覆後自行判斷。";
      notes = [
        notes,
        "本次沒有 Groq Web Search 來源，因此顯示灰藍色 i，而不是無圖示或灰色 ↻。"
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
      model:
        response.actualModel || model,
      requested_model: model,
      search_mode: searchMode,
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
          model: RISK_MODEL,
          requested_model: RISK_MODEL,
          search_mode:
            friendly.failure_type ===
              "request_413"
              ? "compact_retry_failed"
              : "compound_mini_single_search",
          retry_count: 0,
          request_bytes:
            Number(error?.requestBytes) || 0
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
              "這不是球員風險，而是系統目前無法使用 Groq。",
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

  function buildSystemText(
    context,
    customSystemPrompt
  ) {
    const modeRules = {
      rating_summary:
        "本次只附評級數量。直接依 rating_counts 回答，不要要求逐場資料。",
      selected_matches_compact:
        "只附指定場次的精簡必要資料；不得聲稱看過未附欄位或其他場次。",
      compact_overview:
        "附全部或最多80場的超精簡表，適合排行與總覽；未附完整巢狀資料。"
    };

    const contextRule =
      modeRules[context.context_mode] ||
      "只使用本次附上的資料。";

    const custom =
      String(
        customSystemPrompt || ""
      )
        .trim()
        .slice(0, 2000);

    return (
      DEFAULT_SYSTEM_PROMPT +
      "\nJSON是唯一主資料；不得補造賠率、勝率、評級或模型結果。\n" +
      `${contextRule}\n` +
      "Pinnacle賠率是實際分析價格；外網賠率不得取代或重算EV。\n" +
      "只有涉及傷病、退賽、疲勞、旅行、近期狀態與官方公告時，才需要 Groq Compound 內建 Web Search。\n" +
      "簡單數量、評級分布或系統內資料問題，不需要搜尋外網。\n" +
      `目前台灣時間：${taipeiTimeText()}。\n` +
      (
        custom
          ? `\n【使用者自訂系統提示】\n${custom}\n`
          : ""
      ) +
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

  function generationConfigForModel() {
    return {};
  }

  async function ask(question, options = {}) {
    const text = String(
      question || ""
    ).trim();

    if (!text) {
      throw new Error(
        "請先輸入問題。"
      );
    }

    if (text.length > 12000) {
      throw new Error(
        "單次問題過長，請縮短至12000字元內。"
      );
    }

    const analysis =
      options.analysis &&
      typeof options.analysis === "object"
        ? options.analysis
        : {};

    if (
      !analysis.generated_at_taiwan &&
      !Array.isArray(
        analysis.matches
      )
    ) {
      throw new Error(
        "TennisRatio尚未完成分析，Groq暫不開放。"
      );
    }

    const workerUrl = String(
      options.workerUrl || ""
    ).trim().replace(/\/+$/, "");

    if (!workerUrl.startsWith("https://")) {
      throw new Error(
        "Groq Worker URL 必須使用 https://。"
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

    const model = DEFAULT_MODEL;
    const rows = Array.isArray(
      options.rows
    )
      ? options.rows
      : (
          Array.isArray(
            analysis.matches
          )
            ? analysis.matches
            : []
        );
    const history = Array.isArray(
      options.history
    )
      ? options.history
      : [];

    const context = buildContext(
      text,
      {
        payload: options.payload,
        analysis,
        rows,
        revision:
          options.revision,
        history
      }
    );

    const messages = [
      {
        role: "system",
        content: buildSystemText(
          context,
          options.customSystemPrompt
        )
      }
    ];

    for (
      const item of history.slice(
        -MAX_HISTORY_MESSAGES
      )
    ) {
      if (
        !item ||
        typeof item !== "object"
      ) {
        continue;
      }

      const role =
        String(item.role) === "model"
          ? "assistant"
          : "user";
      const value = String(
        item.text ||
        item.content ||
        ""
      ).trim();

      if (value) {
        messages.push({
          role,
          content:
            value.slice(
              0,
              MAX_HISTORY_CHARS
            )
        });
      }
    }

    messages.push({
      role: "user",
      content: text
    });

    const proxyPayload = {
      model,
      request: {
        messages
      }
    };

    let encodedText =
      JSON.stringify(proxyPayload);
    let requestBytes =
      new TextEncoder()
        .encode(encodedText)
        .byteLength;

    // Groq chat safety gate. Remove the oldest conversation history
    // first; preserve the current question and its TennisRatio context.
    while (
      requestBytes > MAX_REQUEST_BYTES &&
      proxyPayload.request.messages.length > 2
    ) {
      proxyPayload.request.messages.splice(
        1,
        1
      );
      encodedText =
        JSON.stringify(proxyPayload);
      requestBytes =
        new TextEncoder()
          .encode(encodedText)
          .byteLength;
    }

    if (
      requestBytes > MAX_REQUEST_BYTES
    ) {
      throw new Error(
        `本次 TennisRatio 資料包仍過大（${requestBytes} bytes）；請指定項次或球員，避免要求全部完整資料。`
      );
    }

    const endpoint =
      `${workerUrl}${DEFAULT_WORKER_PATH}`;
    const fetchImpl =
      options.fetchImpl ||
      global.fetch?.bind(global);

    if (
      typeof fetchImpl !== "function"
    ) {
      throw new Error(
        "目前瀏覽器不支援 fetch。"
      );
    }

    let responsePayload = null;
    let actualModel = model;
    let retryCount = 0;

    for (
      let attempt = 0;
      attempt <= MAX_RETRIES;
      attempt += 1
    ) {
      const controller =
        new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
      );

      try {
        const response =
          await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json; charset=utf-8",
              Authorization:
                `Bearer ${workerToken}`
            },
            body: encodedText,
            signal: controller.signal,
            cache: "no-store"
          });

        if (response.ok) {
          actualModel =
            response.headers.get(
              "X-TennisRatio-Groq-Model"
            ) ||
            model;
          responsePayload =
            await response.json();
          break;
        }

        const detail =
          await readErrorDetail(
            response
          );
        const retryable =
          response.status === 429 ||
          [500, 502, 503, 504]
            .includes(
              response.status
            );

        if (
          retryable &&
          attempt < MAX_RETRIES
        ) {
          retryCount += 1;
          const wait =
            response.status === 429
              ? retrySeconds(
                  response,
                  detail,
                  attempt
                )
              : Math.min(
                  1.5 * (2 ** attempt),
                  12
                );
          await sleep(wait * 1000);
          continue;
        }

        if (response.status === 429) {
          throw new Error(
            "Groq 使用量暫時達到上限（HTTP 429）；已自動重試，請稍後再送。"
          );
        }

        if (response.status === 413) {
          throw new Error(
            `Groq請求資料過大（${requestBytes} bytes）。新版應自動精簡；請按 Ctrl+F5 後重試。`
          );
        }

        throw new Error(
          `Groq Worker錯誤 HTTP ${response.status}：${detail}`
        );
      } catch (error) {
        const isAbort =
          error?.name ===
          "AbortError";
        const retryableNetwork =
          isAbort ||
          error instanceof TypeError;

        if (
          retryableNetwork &&
          attempt < MAX_RETRIES
        ) {
          retryCount += 1;
          await sleep(
            Math.min(
              1.5 * (2 ** attempt),
              12
            ) * 1000
          );
          continue;
        }

        if (isAbort) {
          throw new Error(
            "Groq Worker連線逾時。"
          );
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!responsePayload) {
      throw new Error(
        "Groq Worker沒有回傳資料。"
      );
    }

    const answer =
      extractText(responsePayload);
    const grounding =
      extractGrounding(
        responsePayload
      );

    return {
      answer,
      model: actualModel,
      requested_model: model,
      usage:
        responsePayload.usage || {},
      usage_breakdown:
        responsePayload
          .usage_breakdown || {},
      context_revision:
        Number(
          options.revision || 0
        ),
      context_mode:
        context.context_mode,
      selected_items:
        context.selected_items || [],
      sent_match_count:
        context.sent_match_count || 0,
      total_match_count:
        context.total_match_count || 0,
      retry_count: retryCount,
      request_bytes: requestBytes,
      web_search_used:
        Boolean(
          grounding.sources.length ||
          grounding.queries.length ||
          grounding
            .executed_tools.length
        ),
      web_search_queries:
        grounding.queries,
      grounding_sources:
        grounding.sources,
      executed_tools:
        grounding.executed_tools
    };
  }

  global.TennisRatioGroq = Object.freeze({
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
