(() => {
  "use strict";

  const renderer = window.TennisRatioRenderer;
  const pinnacle = window.TennisRatioPinnacle;
  const r2Client = window.TennisRatioR2Client;
  const sourcePipeline = window.TennisRatioSourcePipeline;
  const analysisEngine = window.TennisRatioAnalysisEngine;
  const geminiClient = window.TennisRatioGemini;
  if (!renderer) throw new Error("renderer.js 尚未載入。");
  if (!pinnacle) throw new Error("pinnacle.js 尚未載入。");
  if (!r2Client) throw new Error("r2-client.js 尚未載入。");
  if (!sourcePipeline) throw new Error("source-pipeline.js 尚未載入。");
  if (!analysisEngine) throw new Error("analysis-engine.js 尚未載入。");
  if (!geminiClient) throw new Error("gemini-client.js 尚未載入。");

  // ============================================================
  // 快速測試階段：前端只需要填入兩組值。
  // Gemini API Key 已移到 Cloudflare Worker Secret。
  // ============================================================
  const ARCADIA_API_KEY =
    "CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R";

  const WORKER_URL =
    "https://tennis-json-store.youjianchonglangshou.workers.dev";

  const WORKER_UPLOAD_TOKEN =
    "tennis_upload_2026_xxxxxxxxxxxxxxxx";

  const DATA_BASE_URL = ".";
  const CHAT_SETTINGS_KEY = "tennisratio.gemini.settings.v1";
  const EXTERNAL_RISK_CACHE_HOURS = 6;
  const ANALYSIS_TOAST_DURATION_MS = 18000;
  const DEFAULT_TENNIS_PROMPT = "你是 TennisRatio 網球賽事分析助理。使用繁體中文，回答清楚、精確、可覆盤。以系統提供的 Pinnacle 與 ratio_analysis.json 為主要依據，不捏造賠率、勝率、評級、D值或五項比較。外網只用於查證傷病、退賽、近期賽程、旅行疲勞與官方消息；使用外網時列出資料來源。區分「較可能獲勝」與「目前賠率是否值得下注」，不要承諾獲利。";

  const state = {
    analysis: null,
    today: null,
    table: null,
    tbody: null,
    activeFilter: "全部",
    closeTimer: null,
    chatHistory: [],
    generating: false,
    rawMatchups: null,
    rawMarkets: null,
    sourceBundle: null,
    config: null,
    externalRisk: null,
    riskScanning: false,
    riskScanTimer: null,
    riskScanGeneration: 0,
    riskCountdownTimer: null,
    toastTimer: null,
    completionNotificationPending: false,
    completionNotificationMode: null
  };

  const elements = {
    body: document.body,
    statusLine: document.getElementById("job-status"),
    statusText: document.getElementById("status-text"),
    visibleCount: document.getElementById("visible-count"),
    emptyFilter: document.getElementById("empty-filter"),
    searchBox: document.getElementById("search-box"),
    card: document.getElementById("card"),
    templatesRoot: document.getElementById("templates-root"),
    updatedTime: document.getElementById("updated-time-value"),
    pinnacleTime: document.getElementById("pinnacle-time-value"),
    drawer: document.getElementById("chat-drawer"),
    chatToggle: document.getElementById("chat-toggle"),
    chatLog: document.getElementById("chat-log"),
    chatInput: document.getElementById("chat-input"),
    chatSend: document.getElementById("chat-send"),
    chatWelcome: document.getElementById("chat-welcome"),
    settingsDialog: document.getElementById("gemini-settings-dialog"),
    downloadPinnacle: document.getElementById("download-pinnacle"),
    downloadRatio: document.getElementById("download-ratio"),
    downloadRisk: document.getElementById("download-risk"),
    riskStatus: document.getElementById("risk-status"),
    riskCacheStatus: document.getElementById("risk-cache-status"),
    riskDialog: document.getElementById("external-risk-dialog"),
    riskDialogTitle: document.getElementById("risk-dialog-title"),
    riskDialogSubtitle: document.getElementById("risk-dialog-subtitle"),
    riskDialogBody: document.getElementById("risk-dialog-body"),
    analysisToast: document.getElementById("analysis-toast"),
    analysisToastTitle: document.getElementById("analysis-toast-title"),
    analysisToastBody: document.getElementById("analysis-toast-body"),
    analysisToastClose: document.getElementById("analysis-toast-close")
  };

  function taiwanTimeText(value) {
    const raw = String(value || "").trim();
    if (!raw) return "時間未知";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return raw.replace("T", " ").split("+")[0];
    }
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
    );
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  }


  function taipeiIsoText(value = Date.now()) {
    const date = value instanceof Date
      ? value
      : new Date(value);
    if (Number.isNaN(date.getTime())) return null;

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
        .formatToParts(date)
        .filter(part => part.type !== "literal")
        .map(part => [part.type, part.value])
    );

    return (
      `${parts.year}-${parts.month}-${parts.day}` +
      `T${parts.hour}:${parts.minute}:${parts.second}+08:00`
    );
  }

  function addHoursIso(value, hours) {
    const time = Date.parse(String(value || ""));
    if (!Number.isFinite(time)) return null;
    return taipeiIsoText(
      time + Number(hours || 0) * 3600000
    );
  }

  function riskCompletedAt() {
    return (
      state.externalRisk?.last_completed_at_taiwan ||
      state.externalRisk?.generated_at_taiwan ||
      null
    );
  }

  function riskNextRefreshAt() {
    return (
      state.externalRisk?.next_refresh_at_taiwan ||
      addHoursIso(
        riskCompletedAt(),
        EXTERNAL_RISK_CACHE_HOURS
      )
    );
  }

  function remainingTimeText(targetValue) {
    const target = Date.parse(String(targetValue || ""));
    if (!Number.isFinite(target)) return "時間未知";

    const remaining = target - Date.now();
    if (remaining <= 0) return "可重新掃描";

    const totalMinutes = Math.ceil(remaining / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return hours > 0
      ? `${hours}小時${minutes}分`
      : `${minutes}分鐘`;
  }

  function updateRiskCacheStatus() {
    if (!elements.riskCacheStatus) return;

    elements.riskCacheStatus.className =
      "risk-cache-status";

    const updatedAt =
      state.externalRisk?.updated_at_taiwan ||
      state.externalRisk?.generated_at_taiwan ||
      null;
    const unfinished = Number(
      state.externalRisk?.scan_unfinished || 0
    );
    const systemErrors = Number(
      state.externalRisk?.system_error_count || 0
    );

    if (state.riskScanning) {
      elements.riskCacheStatus.textContent =
        updatedAt
          ? `上次更新 ${taiwanTimeText(updatedAt)}｜本次掃描中`
          : "風險更新：首次掃描中";
      elements.riskCacheStatus.classList.add(
        "scanning"
      );
      return;
    }

    if (systemErrors > 0) {
      elements.riskCacheStatus.textContent =
        `外部風險系統錯誤｜API Key 或權限需檢查`;
      elements.riskCacheStatus.classList.add(
        "expired"
      );
      return;
    }

    if (unfinished > 0) {
      elements.riskCacheStatus.textContent =
        `風險更新 ${taiwanTimeText(updatedAt)}` +
        `｜未完成 ${unfinished} 場` +
        `｜下次重新分析重試`;
      elements.riskCacheStatus.classList.add(
        "expired"
      );
      return;
    }

    const completedAt = riskCompletedAt();
    const nextRefreshAt = riskNextRefreshAt();

    if (!updatedAt) {
      elements.riskCacheStatus.textContent =
        "風險更新：尚無資料";
      return;
    }

    if (!nextRefreshAt) {
      elements.riskCacheStatus.textContent =
        `風險更新 ${taiwanTimeText(updatedAt)}` +
        `｜下次重新分析時檢查`;
      return;
    }

    const expired =
      Date.parse(nextRefreshAt) <= Date.now();

    elements.riskCacheStatus.textContent =
      `風險更新 ${taiwanTimeText(
        completedAt || updatedAt
      )}` +
      `｜下次 ${remainingTimeText(
        nextRefreshAt
      )}`;

    elements.riskCacheStatus.classList.add(
      expired ? "expired" : "fresh"
    );
  }

  function startRiskCountdownClock() {
    if (state.riskCountdownTimer !== null) {
      clearInterval(state.riskCountdownTimer);
    }
    updateRiskCacheStatus();
    state.riskCountdownTimer = setInterval(
      updateRiskCacheStatus,
      30000
    );
  }

  function hideAnalysisToast() {
    if (state.toastTimer !== null) {
      clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
    if (elements.analysisToast) {
      elements.analysisToast.hidden = true;
      elements.analysisToast.className =
        "analysis-toast";
    }
  }

  function showAnalysisToast(
    title,
    message,
    tone = "success"
  ) {
    if (!elements.analysisToast) return;

    hideAnalysisToast();
    elements.analysisToastTitle.textContent =
      String(title || "分析完成");
    elements.analysisToastBody.textContent =
      String(message || "");
    elements.analysisToast.className =
      `analysis-toast ${tone === "success" ? "" : tone}`.trim();
    elements.analysisToast.hidden = false;

    state.toastTimer = setTimeout(
      hideAnalysisToast,
      ANALYSIS_TOAST_DURATION_MS
    );
  }

  async function prepareCompletionNotification(mode) {
    state.completionNotificationPending = true;
    state.completionNotificationMode = mode;

    if (
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      try {
        await Notification.requestPermission();
      } catch (error) {
        console.info("通知權限未取得。", error);
      }
    }
  }

  function sendSystemNotification(title, body) {
    if (
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    try {
      const notification = new Notification(title, {
        body,
        tag: "tennisratio-analysis-complete",
        renotify: true
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (error) {
      console.info("系統通知建立失敗。", error);
    }
  }

  function clearPendingCompletionNotification() {
    state.completionNotificationPending = false;
    state.completionNotificationMode = null;
  }

  function notifyWholeAnalysisComplete({
    usedCache = false,
    failed = false
  } = {}) {
    if (!state.completionNotificationPending) return;

    const rows = eligibleRiskRows();
    const entries = Array.isArray(
      state.externalRisk?.entries
    )
      ? state.externalRisk.entries
      : [];
    const entryMap = new Map(
      entries.map(entry => [
        String(entry?.match_key || ""),
        entry
      ])
    );

    let riskCount = 0;
    let manualReviewCount = 0;
    let unfinishedCount = 0;
    let systemErrorCount = 0;

    for (const row of rows) {
      const entry = entryMap.get(
        geminiClient.externalRiskMatchKey(row)
      );
      const status =
        geminiClient.normalizeRiskStatus(
          entry?.status
        );

      if (status === "risk_found") {
        riskCount += 1;
      }
      if (status === "manual_review") {
        manualReviewCount += 1;
      }
      if (status === "search_incomplete") {
        unfinishedCount += 1;
      }
      if (status === "system_error") {
        systemErrorCount += 1;
      }
    }

    const modeText =
      state.completionNotificationMode === "full"
        ? "重新抓取＋完整分析"
        : "目前清單重跑";
    const cacheText = usedCache
      ? "外部風險直接沿用 R2 六小時快取。"
      : "外部風險已完成並寫入 R2。";
    const message =
      `${modeText}完成｜A/B ${rows.length}場` +
      `｜警示 ${riskCount}` +
      (
        manualReviewCount
          ? `｜人工判讀 ${manualReviewCount}`
          : ""
      ) +
      (
        unfinishedCount
          ? `｜未完成 ${unfinishedCount}`
          : ""
      ) +
      (
        systemErrorCount
          ? `｜系統錯誤 ${systemErrorCount}`
          : ""
      ) +
      `。${cacheText}`;

    const tone =
      failed ||
      unfinishedCount ||
      systemErrorCount
        ? "warning"
        : "success";

    showAnalysisToast(
      failed
        ? "分析完成，但外部風險有待確認"
        : "TennisRatio 全部分析完成",
      message,
      tone
    );

    sendSystemNotification(
      failed
        ? "TennisRatio 完成｜部分風險待確認"
        : "TennisRatio 全部分析完成",
      message
    );

    clearPendingCompletionNotification();
  }

  function notifyPipelineFailure(error) {
    const message =
      error?.message || String(error);

    showAnalysisToast(
      "TennisRatio 分析失敗",
      message,
      "error"
    );
    sendSystemNotification(
      "TennisRatio 分析失敗",
      message
    );
    clearPendingCompletionNotification();
  }

  async function fetchJson(path) {
    const response = await fetch(`${DATA_BASE_URL}/${path}?v=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`${path} HTTP ${response.status}`);
    }
    return response.json();
  }

  function configurationValue(value, label) {
    const text = String(value || "").trim();
    if (!text || text.includes("請把你的")) {
      throw new Error(`請先打開 app.js，填入 ${label}。`);
    }
    return text;
  }

  async function fetchLatestTodayMatches() {
    try {
      return await r2Client.fetchJson(
        WORKER_URL,
        "today_matches.json"
      );
    } catch (error) {
      console.info(
        "R2 today_matches 尚未建立，改讀儲存庫 fallback。",
        error
      );
      return fetchJson("today_matches.json");
    }
  }

  async function fetchLatestAnalysis() {
    try {
      return await r2Client.fetchJson(
        WORKER_URL,
        "ratio_analysis.json"
      );
    } catch (error) {
      console.info(
        "R2 ratio_analysis 尚未建立，改讀儲存庫 fallback。",
        error
      );
      return fetchJson("ratio_analysis.json");
    }
  }


  async function fetchLatestExternalRisk() {
    try {
      return await r2Client.fetchJson(
        WORKER_URL,
        "external_risk.json"
      );
    } catch (error) {
      console.info(
        "R2 external_risk 尚未建立或不可用。",
        error
      );
      return null;
    }
  }

  function riskEntryMap() {
    const entries = Array.isArray(
      state.externalRisk?.entries
    ) ? state.externalRisk.entries : [];
    return new Map(
      entries.map(entry => [
        String(entry?.match_key || ""), entry
      ])
    );
  }

  function riskEntryForRow(
    row,
    { pending = true } = {}
  ) {
    if (
      !geminiClient.isExternalRiskEligible(row)
    ) {
      return null;
    }

    const key =
      geminiClient.externalRiskMatchKey(row);
    const entry = riskEntryMap().get(key);

    if (
      entry &&
      geminiClient.isRiskCacheFresh(
        entry,
        row
      )
    ) {
      return entry;
    }

    if (
      entry &&
      geminiClient.isRiskFailureStatus(
        entry.status
      )
    ) {
      return entry;
    }

    return pending
      ? {
          match_key: key,
          item: row?.["項次"],
          hot_player: row?.["熱門方"],
          rating: row?.["評級"],
          status: "pending"
        }
      : null;
  }

  function riskByItem(rows) {
    const output = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!geminiClient.isExternalRiskEligible(row)) continue;
      output[String(row?.["項次"] ?? "")] = riskEntryForRow(row);
    }
    return output;
  }

  function eligibleRiskRows() {
    return (Array.isArray(state.analysis?.matches)
      ? state.analysis.matches : [])
      .filter(row => geminiClient.isExternalRiskEligible(row));
  }

  function mergeRiskEntry(entry) {
    const entries = Array.isArray(state.externalRisk?.entries)
      ? [...state.externalRisk.entries] : [];
    const key = String(entry?.match_key || "");
    const index = entries.findIndex(
      item => String(item?.match_key || "") === key
    );
    if (index >= 0) entries[index] = entry;
    else entries.push(entry);
    state.externalRisk = { ...(state.externalRisk || {}), entries };
  }

  function buildExternalRiskDocument(
    scanStatus = "running"
  ) {
    const rows = eligibleRiskRows();
    const map = riskEntryMap();
    const entries = [];

    for (const row of rows) {
      const entry = map.get(
        geminiClient.externalRiskMatchKey(row)
      );
      if (entry) entries.push(entry);
    }

    const resolvedEntries = entries.filter(
      entry =>
        geminiClient.isRiskResolvedStatus(
          entry?.status
        )
    );
    const incompleteEntries = entries.filter(
      entry =>
        geminiClient.normalizeRiskStatus(
          entry?.status
        ) === "search_incomplete"
    );
    const systemErrorEntries = entries.filter(
      entry =>
        geminiClient.normalizeRiskStatus(
          entry?.status
        ) === "system_error"
    );

    const updatedAt = taipeiIsoText();
    const fullyComplete =
      scanStatus === "complete" &&
      incompleteEntries.length === 0 &&
      systemErrorEntries.length === 0 &&
      resolvedEntries.length === rows.length;

    const previousCompletedAt =
      state.externalRisk?.
        last_completed_at_taiwan ||
      null;

    const lastCompletedAt =
      fullyComplete
        ? updatedAt
        : previousCompletedAt;

    const cacheUntilValues =
      resolvedEntries
        .map(entry =>
          Date.parse(
            String(entry?.cache_until || "")
          )
        )
        .filter(Number.isFinite);

    const nextRefreshAt =
      incompleteEntries.length ||
      systemErrorEntries.length
        ? null
        : (
            cacheUntilValues.length
              ? taipeiIsoText(
                  Math.min(...cacheUntilValues)
                )
              : null
          );

    return {
      version:
        "external-risk-v1.3-information-first",
      generated_at_taiwan: updatedAt,
      updated_at_taiwan: updatedAt,
      last_completed_at_taiwan:
        lastCompletedAt,
      next_refresh_at_taiwan:
        nextRefreshAt,
      cache_policy: {
        risk_found_hours: 6,
        clear_hours: 6,
        manual_review_hours: 6,
        search_incomplete_hours: 0,
        system_error_hours: 0
      },
      display_policy: {
        risk_found: "red_double_exclamation",
        clear: "no_icon",
        manual_review: "blue_gray_information",
        search_incomplete: "gray_retry",
        system_error: "header_only"
      },
      analysis_generated_at:
        state.analysis?.
          generated_at_taiwan ?? null,
      scan_status:
        systemErrorEntries.length
          ? "system_error"
          : (
              incompleteEntries.length
                ? "partial"
                : scanStatus
            ),
      scan_total: rows.length,
      scan_completed:
        resolvedEntries.length,
      scan_unfinished:
        incompleteEntries.length,
      system_error_count:
        systemErrorEntries.length,
      risk_found_count:
        resolvedEntries.filter(
          item =>
            geminiClient.normalizeRiskStatus(
              item?.status
            ) === "risk_found"
        ).length,
      clear_count:
        resolvedEntries.filter(
          item =>
            geminiClient.normalizeRiskStatus(
              item?.status
            ) === "clear"
        ).length,
      manual_review_count:
        resolvedEntries.filter(
          item =>
            geminiClient.normalizeRiskStatus(
              item?.status
            ) === "manual_review"
        ).length,
      entries
    };
  }

  function updateRiskStatus() {
    updateRiskCacheStatus();
    if (!elements.riskStatus) return;

    const rows = eligibleRiskRows();
    const map = riskEntryMap();

    let resolved = 0;
    let risks = 0;
    let manualReviews = 0;
    let incomplete = 0;
    let systemErrors = 0;

    for (const row of rows) {
      const entry = map.get(
        geminiClient.externalRiskMatchKey(row)
      );
      if (!entry) continue;

      const status =
        geminiClient.normalizeRiskStatus(
          entry.status
        );

      if (
        geminiClient.isRiskResolvedStatus(
          status
        ) &&
        geminiClient.isRiskCacheFresh(
          entry,
          row
        )
      ) {
        resolved += 1;
        if (status === "risk_found") {
          risks += 1;
        }
        if (status === "manual_review") {
          manualReviews += 1;
        }
      } else if (
        status === "search_incomplete"
      ) {
        incomplete += 1;
      } else if (
        status === "system_error"
      ) {
        systemErrors += 1;
      }
    }

    const processed =
      resolved + incomplete + systemErrors;

    elements.riskStatus.className =
      "risk-status";

    if (!rows.length) {
      elements.riskStatus.textContent =
        "外部風險：無 A／B 待掃描";
      elements.riskStatus.classList.add(
        "complete"
      );
      return;
    }

    if (systemErrors > 0) {
      elements.riskStatus.textContent =
        `外部風險系統錯誤` +
        `｜API Key／權限` +
        `｜已完成 ${resolved}/${rows.length}`;
      elements.riskStatus.classList.add(
        "warning"
      );
      return;
    }

    if (state.riskScanning) {
      elements.riskStatus.textContent =
        `外部風險掃描 ${processed}/${rows.length}` +
        (risks ? `｜警示 ${risks}` : "") +
        (
          manualReviews
            ? `｜人工判讀 ${manualReviews}`
            : ""
        ) +
        (
          incomplete
            ? `｜未完成 ${incomplete}`
            : ""
        );
      elements.riskStatus.classList.add(
        "scanning"
      );
      return;
    }

    if (
      resolved === rows.length &&
      incomplete === 0
    ) {
      elements.riskStatus.textContent =
        `外部風險完成 ${resolved}/${rows.length}` +
        `｜警示 ${risks}` +
        (
          manualReviews
            ? `｜人工判讀 ${manualReviews}`
            : ""
        );
      elements.riskStatus.classList.add(
        risks
          ? "warning"
          : (
              manualReviews
                ? "unknown"
                : "complete"
            )
      );
      return;
    }

    elements.riskStatus.textContent =
      `外部風險部分完成 ${resolved}/${rows.length}` +
      `｜警示 ${risks}` +
      (
        manualReviews
          ? `｜人工判讀 ${manualReviews}`
          : ""
      ) +
      `｜未完成 ${incomplete}`;

    elements.riskStatus.classList.add(
      "unknown"
    );
  }

  function refreshRiskSlot(item, entry) {
    const value = String(item ?? "");
    const selector = `.external-risk-slot[data-risk-item="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"]`;
    document.querySelectorAll(selector).forEach(slot => {
      slot.innerHTML = renderer.externalRiskIcon(entry, item);
    });
  }

  function riskStatusLabel(entry) {
    const status =
      geminiClient.normalizeRiskStatus(
        entry?.status
      );

    if (status === "risk_found") {
      return entry?.severity === "high"
        ? "紅色警示｜高風險"
        : "紅色警示｜需注意";
    }
    if (status === "clear") {
      return "搜尋完成｜沒有相關異常";
    }
    if (status === "manual_review") {
      return "找到外部資訊｜需要人工判讀";
    }
    if (status === "search_incomplete") {
      return "搜尋尚未完成｜下次重試";
    }
    return "外部風險系統錯誤";
  }

  function appendRiskText(parent, className, text) {
    if (!String(text || "").trim()) return;
    const node = document.createElement("p");
    node.className = className;
    node.textContent = String(text);
    parent.appendChild(node);
  }

  function openRiskDialog(entry) {
    const status =
      geminiClient.normalizeRiskStatus(
        entry?.status
      );

    if (
      !entry ||
      entry.status === "pending" ||
      status === "system_error"
    ) {
      return;
    }

    elements.riskDialogTitle.textContent =
      `外部資訊｜${entry.hot_player || "熱門方"}`;
    elements.riskDialogSubtitle.textContent =
      [
        entry.date_time_taipei,
        entry.league,
        `評級 ${entry.rating || "—"}`
      ].filter(Boolean).join("｜");

    const body = elements.riskDialogBody;
    body.innerHTML = "";

    const overview =
      document.createElement("section");
    overview.className =
      `risk-overview ${
        status === "manual_review"
          ? "risk-review"
          : (
              status === "search_incomplete"
                ? "risk-incomplete"
                : status
            )
      }`;

    const badge =
      document.createElement("span");
    badge.className =
      `risk-badge ${
        status === "manual_review"
          ? "risk-review"
          : (
              status === "search_incomplete"
                ? "risk-incomplete"
                : status
            )
      }`;
    badge.textContent =
      riskStatusLabel(entry);
    overview.appendChild(badge);

    appendRiskText(
      overview,
      "risk-summary",
      entry.summary
    );
    appendRiskText(
      overview,
      "risk-impact",
      entry.impact
    );
    body.appendChild(overview);

    const findings = Array.isArray(
      entry.findings
    )
      ? entry.findings
      : (
          Array.isArray(entry.evidence)
            ? entry.evidence
            : []
        );

    if (findings.length) {
      const section =
        document.createElement("section");
      section.className = "risk-section";

      const title =
        document.createElement("h3");
      title.textContent =
        status === "risk_found"
          ? "找到的不利資訊"
          : "搜尋到的資訊";
      section.appendChild(title);

      const list =
        document.createElement("ol");
      list.className = "risk-evidence";

      for (const finding of findings) {
        const item =
          document.createElement("li");

        const heading =
          document.createElement("div");
        heading.className =
          "risk-finding-heading";

        const time =
          document.createElement("time");
        time.textContent =
          finding?.date || "日期未明";
        heading.appendChild(time);

        const titleText =
          String(
            finding?.title ||
            finding?.fact ||
            "近期資訊"
          );
        heading.appendChild(
          document.createTextNode(
            `｜${titleText}`
          )
        );
        item.appendChild(heading);

        if (
          finding?.fact &&
          finding.fact !== titleText
        ) {
          const fact =
            document.createElement("div");
          fact.className =
            "risk-finding-fact";
          fact.textContent =
            finding.fact;
          item.appendChild(fact);
        }

        if (finding?.relevance) {
          const relevance =
            document.createElement("small");
          relevance.textContent =
            `與本場的可能關係：${finding.relevance}`;
          item.appendChild(relevance);
        }

        list.appendChild(item);
      }

      section.appendChild(list);
      body.appendChild(section);
    }

    if (
      status === "manual_review" &&
      entry.raw_search_text
    ) {
      const section =
        document.createElement("section");
      section.className = "risk-section";

      const title =
        document.createElement("h3");
      title.textContent =
        "Gemini 搜尋整理";
      section.appendChild(title);

      const raw =
        document.createElement("div");
      raw.className =
        "risk-raw-search";
      raw.textContent =
        String(entry.raw_search_text);
      section.appendChild(raw);
      body.appendChild(section);
    }

    if (
      Array.isArray(entry.sources) &&
      entry.sources.length
    ) {
      const section =
        document.createElement("section");
      section.className = "risk-section";

      const title =
        document.createElement("h3");
      title.textContent = "查證來源";
      section.appendChild(title);

      const list =
        document.createElement("ul");
      list.className = "risk-source-list";

      for (const source of entry.sources) {
        const uri =
          String(source?.uri || "").trim();
        if (!uri) continue;

        const item =
          document.createElement("li");
        const link =
          document.createElement("a");
        link.href = uri;
        link.target = "_blank";
        link.rel =
          "noopener noreferrer";
        link.textContent =
          String(source?.title || uri);
        item.appendChild(link);
        list.appendChild(item);
      }

      section.appendChild(list);
      body.appendChild(section);
    }

    if (entry.notes) {
      const notes =
        document.createElement("section");
      notes.className = "risk-section";

      const title =
        document.createElement("h3");
      title.textContent =
        status === "manual_review"
          ? "系統判斷"
          : (
              status === "search_incomplete"
                ? "為什麼尚未完成"
                : "補充"
            );
      notes.appendChild(title);

      appendRiskText(
        notes,
        "risk-note-text",
        entry.notes
      );
      body.appendChild(notes);
    }

    const meta =
      document.createElement("div");
    meta.className = "risk-meta";

    const confidence =
      Number(entry.confidence);

    meta.textContent =
      `檢查時間：${
        taiwanTimeText(entry.checked_at)
      }` +
      `｜可信度：${
        Number.isFinite(confidence)
          ? `${Math.round(
              confidence * 100
            )}%`
          : "—"
      }` +
      `｜模型：${entry.model || "—"}`;
    body.appendChild(meta);

    const disclaimer =
      document.createElement("div");
    disclaimer.className =
      "risk-disclaimer";

    if (status === "manual_review") {
      disclaimer.textContent =
        "灰藍色 i 代表已找到資訊，但不由系統武斷決定。請閱讀上方內容與來源，自行判斷是否影響本場。";
    } else if (
      status === "search_incomplete"
    ) {
      disclaimer.textContent =
        "灰色 ↻ 只表示搜尋尚未完成，不代表球員有風險，也不代表安全；下次重新分析會自動重試。";
    } else {
      disclaimer.textContent =
        "紅色警示是評級後的獨立外部覆核，不會自動修改 A／B。";
    }

    body.appendChild(disclaimer);
    elements.riskDialog.showModal();
  }

  async function persistExternalRisk(scanStatus) {
    const token = configurationValue(WORKER_UPLOAD_TOKEN, "WORKER_UPLOAD_TOKEN");
    const documentData = buildExternalRiskDocument(scanStatus);
    state.externalRisk = documentData;
    updateRiskCacheStatus();
    await r2Client.uploadExternalRisk(
      WORKER_URL,
      token,
      documentData
    );
    return documentData;
  }

  function cancelExternalRiskScan() {
    state.riskScanGeneration += 1;
    state.riskScanning = false;
    if (state.riskScanTimer !== null) {
      clearTimeout(state.riskScanTimer);
      state.riskScanTimer = null;
    }
    updateRiskStatus();
  }

  async function startExternalRiskScan() {
    if (
      state.riskScanning ||
      !state.analysis?.matches
    ) {
      return;
    }

    const generation = state.riskScanGeneration;
    const rows = eligibleRiskRows();

    if (!rows.length) {
      updateRiskStatus();
      notifyWholeAnalysisComplete({
        usedCache: true
      });
      return;
    }

    const existingEntries = Array.isArray(
      state.externalRisk?.entries
    )
      ? state.externalRisk.entries
      : [];
    const oldMap = new Map(
      existingEntries.map(entry => [
        String(entry?.match_key || ""),
        entry
      ])
    );
    const staleRows = rows.filter(row =>
      !geminiClient.isRiskCacheFresh(
        oldMap.get(
          geminiClient.externalRiskMatchKey(row)
        ),
        row
      )
    );

    if (!staleRows.length) {
      updateRiskStatus();
      notifyWholeAnalysisComplete({
        usedCache: true
      });
      return;
    }

    let workerToken;
    try {
      workerToken = configurationValue(
        WORKER_UPLOAD_TOKEN,
        "WORKER_UPLOAD_TOKEN"
      );
    } catch (error) {
      console.error(error);
      for (const row of staleRows) {
        const match =
          geminiClient.compactRiskMatch(row);
        const entry = {
          ...match,
          status: "system_error",
          severity: "unknown",
          confidence: 0,
          summary:
            "整批外部風險掃描已停止：系統缺少 Worker Token。",
          impact:
            "這不是球員風險，而是系統驗證設定尚未完成。",
          evidence: [],
          notes:
            "請檢查 app.js 的 WORKER_UPLOAD_TOKEN。",
          search_completed: false,
          failure_type: "auth_401_403",
          http_status: null,
          retry_after_seconds: null,
          cache_hours: 0,
          cache_until: null,
          used_cache: false,
          technical_error: error.message,
          sources: [],
          checked_at: new Date().toISOString(),
          model: geminiSettings.model
        };
        mergeRiskEntry(entry);
        refreshRiskSlot(row?.["項次"], entry);
      }
      updateRiskStatus();
      notifyWholeAnalysisComplete({
        usedCache: false,
        failed: true
      });
      return;
    }

    state.riskScanning = true;
    updateRiskStatus();

    let scanFailed = false;

    try {
      const result =
        await geminiClient.scanExternalRisks(
          rows,
          {
            existingEntries,
            workerUrl: WORKER_URL,
            workerToken,
            model: geminiSettings.model,
            delayMs: 1400,
            onPending: async row => {
              if (
                generation !==
                state.riskScanGeneration
              ) {
                throw new Error(
                  "RISK_SCAN_SUPERSEDED"
                );
              }
              refreshRiskSlot(
                row?.["項次"],
                {
                  status: "pending",
                  item: row?.["項次"]
                }
              );
            },
            onEntry: async (entry, progress) => {
              if (
                generation !==
                state.riskScanGeneration
              ) {
                throw new Error(
                  "RISK_SCAN_SUPERSEDED"
                );
              }

              mergeRiskEntry(entry);
              refreshRiskSlot(entry.item, entry);
              updateRiskStatus();

              try {
                await persistExternalRisk("running");
              } catch (error) {
                console.error(
                  "external_risk 暫存失敗",
                  error
                );
              }

              elements.statusText.textContent =
                `外部風險覆核｜已完成 ` +
                `${progress.completed}/${progress.total}` +
                `｜熱門方 ${entry.hot_player}` +
                `｜${riskStatusLabel(entry)}`;
            },
            onProgress: updateRiskStatus
          }
        );

      if (
        generation !== state.riskScanGeneration
      ) {
        throw new Error("RISK_SCAN_SUPERSEDED");
      }

      for (const entry of result.entries) {
        mergeRiskEntry(entry);
        refreshRiskSlot(entry.item, entry);
      }

      const hasSystemError =
        result.entries.some(entry =>
          geminiClient.normalizeRiskStatus(
            entry?.status
          ) === "system_error"
        );

      await persistExternalRisk(
        hasSystemError
          ? "system_error"
          : (
              result.unresolved > 0
                ? "partial"
                : "complete"
            )
      );

      scanFailed =
        scanFailed ||
        result.unresolved > 0;
    } catch (error) {
      if (
        error?.message !==
        "RISK_SCAN_SUPERSEDED"
      ) {
        scanFailed = true;
        console.error(
          "外部風險掃描發生未預期錯誤",
          error
        );
        elements.statusText.textContent =
          `外部風險掃描錯誤：${error.message}`;
      }
    } finally {
      if (
        generation === state.riskScanGeneration
      ) {
        state.riskScanning = false;
        updateRiskStatus();

        notifyWholeAnalysisComplete({
          usedCache: false,
          failed: scanFailed
        });
      }
    }
  }

  function scheduleExternalRiskScan(delay = 500) {
    if (state.riskScanTimer !== null) clearTimeout(state.riskScanTimer);
    state.riskScanTimer = setTimeout(() => {
      state.riskScanTimer = null;
      void startExternalRiskScan();
    }, delay);
  }

  function updateTodayState(today) {
    state.today = today;
    elements.pinnacleTime.textContent = taiwanTimeText(today?.query_time);
  }

  function saveJsonToComputer(data, filename) {
    if (!data || typeof data !== "object") {
      throw new Error(`${filename} 尚無可下載資料。`);
    }

    const jsonText = JSON.stringify(data, null, 2);
    const blob = new Blob(
      [jsonText],
      { type: "application/json;charset=utf-8" }
    );
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(
      () => URL.revokeObjectURL(objectUrl),
      10000
    );
  }

  async function downloadCurrentJson(kind) {
    const isPinnacle = kind === "pinnacle";
    const isRisk = kind === "risk";
    const filename = isPinnacle
      ? "today_matches.json"
      : (
          isRisk
            ? "external_risk.json"
            : "ratio_analysis.json"
        );

    try {
      let data;

      if (isPinnacle) {
        data =
          state.today ||
          await fetchLatestTodayMatches();
        updateTodayState(data);
      } else if (isRisk) {
        data =
          state.externalRisk ||
          await fetchLatestExternalRisk();
        if (!data) {
          throw new Error(
            "R2 尚無 external_risk.json。"
          );
        }
        state.externalRisk = data;
        updateRiskStatus();
      } else {
        data =
          state.analysis ||
          await fetchLatestAnalysis();
        state.analysis = data;
      }

      saveJsonToComputer(data, filename);
      elements.statusLine.classList.remove("error");
      elements.statusText.textContent =
        `${filename} 已下載到電腦。`;
    } catch (error) {
      console.error(error);
      elements.statusLine.classList.add("error");
      elements.statusText.textContent =
        `下載失敗：${error?.message || String(error)}`;
    }
  }

  async function runAnalysisPhase4(sourceBundle, uploadToken) {
    if (!state.config) {
      state.config = await fetchJson("ratio_config.json");
    }
    elements.statusText.textContent =
      `Phase 4｜開始執行 Formula B、15項、5項、D值、EV、評級與BO3……`;

    const analysis = await analysisEngine.buildAnalysis(
      sourceBundle,
      state.config,
      {
        progress: message => {
          elements.statusText.textContent = message;
        }
      }
    );

    elements.statusText.textContent =
      `Phase 4｜已完成 ${analysis.matches.length} 場分析；正在寫入 R2 ratio_analysis.json……`;
    const uploadResult = await r2Client.uploadAnalysis(
      WORKER_URL,
      uploadToken,
      analysis
    );
    const savedAnalysis = await r2Client.fetchJson(WORKER_URL, "ratio_analysis.json");
    state.analysis = savedAnalysis;
    renderAnalysis(savedAnalysis, state.today);
    scheduleExternalRiskScan(650);

    const health = savedAnalysis.run_health || {};
    const ratings = health.rating_counts || {};
    elements.statusText.textContent =
      `Phase 4完成｜ratio_analysis ${savedAnalysis.matches?.length || 0} 場｜` +
      `A ${ratings.A || 0}｜B ${ratings.B || 0}｜C ${ratings.C || 0}｜淘汰 ${ratings["淘汰"] || ratings["淘汰＋過期"] || 0}｜` +
      `R2 ${uploadResult.ratioAnalysisBytes || 0} bytes`;
    return savedAnalysis;
  }

  async function runSourcePhase4(today, uploadToken) {
    elements.statusText.textContent =
      `Phase 3｜開始取得 ${today.matches?.length || 0} 場的365Scores與TennisRatio資料……`;

    const sourceBundle = await sourcePipeline.buildSourceBundle(today, {
      workerUrl: WORKER_URL,
      concurrency: 2,
      progress: message => {
        elements.statusText.textContent = message;
      }
    });

    elements.statusText.textContent =
      `Phase 3｜外部資料已整理 ${sourceBundle.matches.length} 場；正在寫入 R2 source_bundle.json……`;
    await r2Client.uploadSourceBundle(
      WORKER_URL,
      uploadToken,
      sourceBundle
    );
    const savedBundle = await r2Client.fetchJson(WORKER_URL, "source_bundle.json");
    state.sourceBundle = savedBundle;

    const health = savedBundle.source_health || {};
    elements.statusText.textContent =
      `Phase 3完成｜source_bundle ${savedBundle.matches?.length || 0} 場｜` +
      `場地 ${health.surface_resolved || 0} 場｜雙方球員完整識別 ${health.both_players_found || 0} 場｜準備進入 Phase 4`;

    return runAnalysisPhase4(savedBundle, uploadToken);
  }

  async function runFullPipelinePhase4() {
    cancelExternalRiskScan();
    setRunning(true);
    elements.statusLine.classList.remove("error");
    elements.statusText.textContent =
      "正在檢查 ARCADIA_API_KEY 與 WORKER_UPLOAD_TOKEN……";

    try {
      const apiKey = configurationValue(
        ARCADIA_API_KEY,
        "ARCADIA_API_KEY"
      );
      const uploadToken = configurationValue(
        WORKER_UPLOAD_TOKEN,
        "WORKER_UPLOAD_TOKEN"
      );

      elements.statusText.textContent =
        "Phase 2｜正在由目前瀏覽器同時抓取 Arcadia matchups 與 markets……";
      const [matchups, markets] = await Promise.all([
        pinnacle.fetchArcadiaJson(pinnacle.MATCHUPS_URL, apiKey),
        pinnacle.fetchArcadiaJson(pinnacle.MARKETS_URL, apiKey)
      ]);
      state.rawMatchups = matchups;
      state.rawMarkets = markets;

      elements.statusText.textContent =
        `Phase 2｜已取得 matchups ${matchups.length} 筆、markets ${markets.length} 筆；正在組合 today_matches.json……`;
      const today = pinnacle.buildTodayMatches(matchups, markets, {
        minOdds: 1.5,
        maxOdds: 1.75
      });

      elements.statusText.textContent =
        `Phase 2｜today_matches 已建立 ${today.matches.length} 場；正在寫入 Cloudflare R2……`;
      await r2Client.uploadOddsBundle(
        WORKER_URL,
        uploadToken,
        { matchups, markets, todayMatches: today }
      );

      const savedToday = await r2Client.fetchJson(WORKER_URL, "today_matches.json");
      updateTodayState(savedToday);

      await runSourcePhase4(savedToday, uploadToken);
    } catch (error) {
      console.error(error);
      elements.statusLine.classList.add("error");
      elements.statusText.textContent =
        `完整分析執行失敗：${error.message}`;
      notifyPipelineFailure(error);
    } finally {
      setRunning(false);
    }
  }

  async function rerunCurrentListPhase4() {
    cancelExternalRiskScan();
    setRunning(true);
    elements.statusLine.classList.remove("error");
    elements.statusText.textContent =
      "正在檢查 WORKER_UPLOAD_TOKEN……";

    try {
      const uploadToken = configurationValue(
        WORKER_UPLOAD_TOKEN,
        "WORKER_UPLOAD_TOKEN"
      );

      elements.statusText.textContent =
        "只重跑目前清單｜正在從 R2 讀取既有 today_matches.json……";
      const today = await fetchLatestTodayMatches();
      updateTodayState(today);
      await runSourcePhase4(today, uploadToken);
    } catch (error) {
      console.error(error);
      elements.statusLine.classList.add("error");
      elements.statusText.textContent =
        `目前清單完整分析失敗：${error.message}`;
      notifyPipelineFailure(error);
    } finally {
      setRunning(false);
    }
  }

  function updateFilterCounts(counts) {
    document.querySelectorAll(".filter-chip").forEach(button => {
      const name = button.dataset.filter || "全部";
      const count = counts[name] ?? 0;
      const target = button.querySelector("b");
      if (target) target.textContent = String(count);
    });
  }

  function renderAnalysis(analysis, today) {
    state.riskScanGeneration += 1;
    const rows = Array.isArray(analysis?.matches) ? analysis.matches : [];
    const rendered = renderer.renderRows(rows, {
      riskByItem: riskByItem(rows)
    });

    state.table = document.querySelector("table.main");
    state.tbody = state.table?.tBodies?.[0] || null;
    if (!state.table || !state.tbody) {
      throw new Error("主表格容器不存在。");
    }

    state.tbody.innerHTML = rendered.rowsHtml;
    elements.templatesRoot.innerHTML = rendered.templatesHtml;
    updateFilterCounts(rendered.counts);

    elements.updatedTime.textContent = taiwanTimeText(analysis?.generated_at_taiwan);
    elements.pinnacleTime.textContent = taiwanTimeText(today?.query_time);
    elements.body.dataset.analysisReady = rows.length ? "1" : "0";
    elements.body.dataset.revision = String(Date.now());

    elements.chatToggle.disabled = rows.length === 0;
    elements.chatToggle.title = rows.length
      ? "分析資料已載入，可開啟Gemini問答"
      : "分析尚未完成，Gemini暫不可用";
    const chatContextText = document.getElementById("chat-context-text");
    if (chatContextText) {
      chatContextText.innerHTML = rows.length
        ? `分析資料已載入：<b>${rows.length} 場</b>｜單場問題只傳相關場次，不傳整份巢狀 JSON`
        : "分析尚未完成，Gemini暫不可用";
    }

    setupSorting();
    applyFilters();
    updateRiskStatus();

    const todayCount = Array.isArray(today?.matches) ? today.matches.length : 0;
    elements.statusLine.classList.remove("running", "error");
    elements.statusText.textContent =
      `全JS動態渲染完成｜ratio_analysis ${rows.length}場｜Pinnacle清單 ${todayCount}場｜主表格與 Hover 卡片由 app.js 即時建立`;
  }

  function setupSorting() {
    if (!state.table || !state.tbody) return;
    state.table.querySelectorAll("th:not([data-nosort])").forEach(th => {
      th.onclick = () => {
        const index = th.cellIndex;
        const descending = th.classList.contains("asc");
        state.table.querySelectorAll("th").forEach(item => item.classList.remove("asc", "desc"));
        th.classList.add(descending ? "desc" : "asc");
        const rows = [...state.tbody.rows];
        rows.sort((left, right) => {
          let x = left.cells[index]?.dataset.sort || "";
          let y = right.cells[index]?.dataset.sort || "";
          if (th.dataset.type === "number") {
            x = Number(x);
            y = Number(y);
          }
          return (x < y ? -1 : x > y ? 1 : 0) * (descending ? -1 : 1);
        });
        rows.forEach(row => state.tbody.appendChild(row));
      };
    });
  }

  function applyFilters() {
    if (!state.tbody) return;
    const needle = elements.searchBox.value.trim().toLocaleLowerCase("zh-Hant");
    let visible = 0;
    [...state.tbody.rows].forEach(row => {
      const rowRating = row.dataset.rating || "";
      const isColdCandidate = (row.dataset.coldCandidate || "0") === "1";
      const ratingOK = state.activeFilter === "全部"
        || (state.activeFilter === "冷門方"
          ? isColdCandidate
          : rowRating === state.activeFilter || rowRating.includes(state.activeFilter));
      const searchOK = !needle || (row.dataset.search || "").includes(needle);
      row.hidden = !(ratingOK && searchOK);
      if (!row.hidden) visible += 1;
    });
    elements.visibleCount.textContent = `顯示 ${visible}／${state.tbody.rows.length} 場`;
    elements.emptyFilter.style.display = visible ? "none" : "block";
  }

  function setRunning(running) {
    document.querySelectorAll(".run-button").forEach(button => {
      button.disabled = running;
    });
    elements.statusLine.classList.toggle("running", running);
    elements.chatToggle.disabled = running || elements.body.dataset.analysisReady !== "1";
    elements.chatToggle.title = running
      ? "分析進行中，Gemini暫不可用"
      : "分析資料已載入，可開啟Gemini問答";
    if (running && elements.drawer?.classList.contains("open")) setDrawer(false);
  }

  function fitIntegratedCardToContent() {
    if (!elements.card.classList.contains("integrated-card")) return;
    let statsRequired = Number(
      getComputedStyle(elements.card).getPropertyValue("--stats-pane-min").replace("px", "")
    ) || 430;
    elements.card.querySelectorAll(".stats-tab-panel.active .compare-table").forEach(table => {
      statsRequired = Math.max(statsRequired, Math.ceil(table.scrollWidth + 6));
    });
    const names = [...elements.card.querySelectorAll(".bo3-player-name")];
    if (names.length >= 2) {
      const bo3Required = names.slice(0, 2)
        .reduce((total, node) => total + Math.ceil(node.scrollWidth) + 32, 18);
      statsRequired = Math.max(statsRequired, bo3Required);
    }
    statsRequired = Math.min(920, Math.max(430, statsRequired));
    elements.card.style.setProperty("--stats-pane-min", `${statsRequired}px`);
    const formula = elements.card.querySelector(".formula-section");
    const formulaRequired = Math.max(680, formula ? Math.ceil(formula.scrollWidth) : 680);
    const measuredWidth = statsRequired + formulaRequired + 36;
    const templateWidth = Number(elements.card.dataset.desiredWidth || 1260);
    elements.card.dataset.desiredWidth = String(
      Math.min(1780, Math.max(templateWidth, measuredWidth))
    );
  }

  function placeCard(target) {
    const rect = target.getBoundingClientRect();
    const gap = 10;

    if (elements.card.classList.contains("integrated-card")) {
      const ratingGap = 14;
      const desired = Number(
        elements.card.dataset.desiredWidth || 1080
      );
      const requestedWidth = Math.min(
        desired,
        window.innerWidth - 16
      );

      elements.card.style.width = `${requestedWidth}px`;
      elements.card.style.maxWidth = "none";

      /*
       * styles.css 會用 !important 將完整分析卡限制在
       * 約 1080px。舊版仍用 requestedWidth 計算 left，
       * 所以卡片實際縮小後，右側會留下過大的空白。
       *
       * 現在改用瀏覽器實際渲染寬度：
       * 卡片右邊緣 ← 14px → 評級膠囊左邊緣。
       */
      const renderedWidth =
        elements.card.getBoundingClientRect().width;

      let left =
        rect.left -
        renderedWidth -
        ratingGap;

      if (left < 8) {
        left = 8;
      }

      if (
        left + renderedWidth >
        window.innerWidth - 8
      ) {
        left =
          window.innerWidth -
          renderedWidth -
          8;
      }

      elements.card.style.left =
        `${Math.max(8, Math.round(left))}px`;

      const height = elements.card.offsetHeight;
      let top = rect.bottom + gap;

      if (top + height > window.innerHeight - 8) {
        top = Math.max(
          8,
          rect.top - height - gap
        );
      }

      elements.card.style.top = `${top}px`;
      return;
    }

    const width = elements.card.offsetWidth;
    const height = elements.card.offsetHeight;
    const left = Math.min(
      window.innerWidth - width - 8,
      Math.max(8, rect.left)
    );
    let top = rect.bottom + gap;

    if (top + height > window.innerHeight - 8) {
      top = Math.max(
        8,
        rect.top - height - gap
      );
    }

    elements.card.style.left = `${left}px`;
    elements.card.style.top = `${top}px`;
  }

  function cancelClose() {
    if (state.closeTimer !== null) {
      clearTimeout(state.closeTimer);
      state.closeTimer = null;
    }
  }

  function hideCard() {
    cancelClose();
    elements.card.style.display = "none";
    elements.card.className = "";
    elements.card.style.maxWidth = "";
    elements.card.style.width = "";
    elements.card.style.removeProperty("--stats-pane-min");
    delete elements.card.dataset.desiredWidth;
  }

  function hideLater() {
    cancelClose();
    state.closeTimer = setTimeout(() => {
      if (!elements.card.matches(":hover")) hideCard();
    }, 160);
  }

  function showCard(target) {
    cancelClose();
    const template = document.getElementById(target.dataset.template);
    if (!template) return;
    elements.card.innerHTML = template.innerHTML;
    elements.card.className = target.dataset.cardKind || "";
    elements.card.dataset.desiredWidth = template.dataset.cardWidth || "1260";
    elements.card.style.setProperty("--stats-pane-min", `${template.dataset.statsMin || "430"}px`);
    elements.card.style.display = "block";
    requestAnimationFrame(() => {
      fitIntegratedCardToContent();
      requestAnimationFrame(() => placeCard(target));
    });
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      let copied = false;
      try { copied = document.execCommand("copy"); } catch (_) { copied = false; }
      area.remove();
      return copied;
    }
  }

  function copyValue(button) {
    if (button.dataset.copyKind === "match") {
      return `${button.dataset.copyDate || ""}\t${button.dataset.copyHome || ""}  vs  ${button.dataset.copyAway || ""}`;
    }
    return button.dataset.copy || "";
  }

  function loadGeminiSettings() {
    const defaults = {
      model: "gemini-2.5-flash",
      systemPrompt: DEFAULT_TENNIS_PROMPT
    };

    try {
      const saved = JSON.parse(
        localStorage.getItem(CHAT_SETTINGS_KEY) || "{}"
      );

      return {
        model:
          String(saved.model || defaults.model)
            .trim(),
        systemPrompt:
          String(
            saved.systemPrompt || defaults.systemPrompt
          ).trim()
      };
    } catch (error) {
      return defaults;
    }
  }

  let geminiSettings = loadGeminiSettings();

  function persistGeminiSettings() {
    localStorage.setItem(
      CHAT_SETTINGS_KEY,
      JSON.stringify({
        model: geminiSettings.model,
        systemPrompt: geminiSettings.systemPrompt
      })
    );

    document.getElementById(
      "chat-model-label"
    ).textContent =
      geminiSettings.model || "gemini-2.5-flash";
  }

  function setDrawer(open) {
    if (elements.body.dataset.analysisReady !== "1") return;
    elements.drawer.classList.toggle("open", open);
    elements.drawer.setAttribute("aria-hidden", open ? "false" : "true");
    elements.chatToggle.classList.toggle("active", open);
    elements.chatToggle.setAttribute("aria-expanded", open ? "true" : "false");
    hideCard();
    if (open) {
      setTimeout(() => elements.chatInput.focus(), 230);
    }
  }

  function openGeminiSettings() {
    document.getElementById(
      "gemini-model"
    ).value =
      geminiSettings.model || "gemini-2.5-flash";

    document.getElementById(
      "gemini-system-prompt"
    ).value =
      geminiSettings.systemPrompt ||
      DEFAULT_TENNIS_PROMPT;

    document.getElementById(
      "settings-status"
    ).textContent =
      "Gemini API Key：由 Cloudflare Worker Secret 管理";

    elements.settingsDialog.showModal();
  }

  function createChatMessage(role, text = "") {
    if (elements.chatWelcome) elements.chatWelcome.hidden = true;
    const message = document.createElement("div");
    message.className = `chat-message ${role}`;
    const body = document.createElement("span");
    body.className = "chat-message-body";
    body.textContent = text;
    message.appendChild(body);
    elements.chatLog.appendChild(message);
    elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
    return { message, body };
  }

  function appendError(text) {
    createChatMessage("error", text);
  }

  function addSources(message, sources, queries = []) {
    if (Array.isArray(queries) && queries.length) {
      const meta = document.createElement("div");
      meta.className = "chat-meta";
      meta.textContent = `Google Search：${queries.join("、")}`;
      message.appendChild(meta);
    }
    if (Array.isArray(sources) && sources.length) {
      const title = document.createElement("div");
      title.className = "chat-sources-title";
      title.textContent = "資料來源";
      message.appendChild(title);
      const list = document.createElement("ul");
      list.className = "chat-sources";
      for (const source of sources) {
        const uri = String(source?.uri || "").trim();
        if (!uri) continue;
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = uri;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = String(source?.title || uri || "外網來源");
        item.appendChild(link);
        list.appendChild(item);
      }
      if (list.childElementCount) message.appendChild(list);
    }
  }

  function addContextMeta(message, result) {
    const meta = document.createElement("div");
    meta.className = "chat-meta";
    const mode = result.context_mode === "selected_matches"
      ? "指定場次完整資料"
      : "全部場次精簡總覽";
    const retryText = result.retry_count
      ? `｜重試 ${result.retry_count} 次`
      : "";
    const bytesText = Number.isFinite(Number(result.request_bytes))
      ? `｜請求 ${(Number(result.request_bytes) / 1024).toFixed(1)} KB`
      : "";
    meta.textContent =
      `本次上下文：${mode}｜傳送 ${result.sent_match_count || 0}/${result.total_match_count || 0} 場` +
      `${bytesText}${retryText}`;
    message.appendChild(meta);
  }

  async function typeAnswer(target, text) {
    target.body.textContent = "";
    const cursor = document.createElement("i");
    cursor.className = "typing-cursor";
    target.message.appendChild(cursor);
    for (let index = 0; index < text.length; index += 4) {
      target.body.textContent += text.slice(index, index + 4);
      elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
      await new Promise(resolve => setTimeout(resolve, 8));
    }
    cursor.remove();
  }

  async function loadData() {
    setRunning(true);
    elements.statusText.textContent =
      "正在以 JavaScript 讀取 R2 ratio_analysis.json、today_matches.json、source_bundle.json 與 ratio_config.json……";
    try {
      const [analysis, today, sourceBundle, config, externalRisk] = await Promise.all([
        fetchLatestAnalysis(),
        fetchLatestTodayMatches(),
        r2Client.fetchJson(WORKER_URL, "source_bundle.json").catch(() => null),
        fetchJson("ratio_config.json"),
        fetchLatestExternalRisk()
      ]);
      state.analysis = analysis;
      state.today = today;
      state.sourceBundle = sourceBundle;
      state.config = config;
      state.externalRisk = externalRisk;
      startRiskCountdownClock();
      renderAnalysis(analysis, today);
      scheduleExternalRiskScan(800);
      if (sourceBundle?.matches) {
        const health = sourceBundle.source_health || {};
        const missingSettings = [];
        if (
          !String(ARCADIA_API_KEY || "").trim() ||
          String(ARCADIA_API_KEY).includes("請把你的")
        ) {
          missingSettings.push("ARCADIA_API_KEY");
        }
        if (
          !String(WORKER_UPLOAD_TOKEN || "").trim() ||
          String(WORKER_UPLOAD_TOKEN).includes("請把你的")
        ) {
          missingSettings.push("WORKER_UPLOAD_TOKEN");
        }
        const warning = missingSettings.length
          ? `｜重新分析前請在 app.js 填入 ${missingSettings.join("、")}`
          : "";

        elements.statusText.textContent =
          `Phase 4系統已就緒｜ratio_analysis ${analysis.matches?.length || 0}場｜` +
          `source_bundle ${sourceBundle.matches.length}場｜場地 ${health.surface_resolved || 0}場｜` +
          `雙方球員識別 ${health.both_players_found || 0}場${warning}`;
      }
    } catch (error) {
      console.error(error);
      elements.statusLine.classList.add("error");
      elements.statusText.textContent = `動態渲染失敗：${error.message}`;
      elements.body.dataset.analysisReady = "0";
    } finally {
      setRunning(false);
    }
  }

  document.querySelectorAll(".filter-chip").forEach(button => {
    button.addEventListener("click", () => {
      state.activeFilter = button.dataset.filter || "全部";
      document.querySelectorAll(".filter-chip").forEach(item => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", active ? "true" : "false");
      });
      applyFilters();
    });
  });

  elements.searchBox.addEventListener("input", applyFilters);

  elements.analysisToastClose.addEventListener(
    "click",
    hideAnalysisToast
  );

  elements.downloadPinnacle.addEventListener(
    "click",
    event => {
      event.preventDefault();
      void downloadCurrentJson("pinnacle");
    }
  );

  elements.downloadRatio.addEventListener(
    "click",
    event => {
      event.preventDefault();
      void downloadCurrentJson("ratio");
    }
  );

  elements.downloadRisk.addEventListener(
    "click",
    event => {
      event.preventDefault();
      void downloadCurrentJson("risk");
    }
  );

  document.querySelectorAll(".run-button").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        await prepareCompletionNotification(
          button.dataset.mode === "full"
            ? "full"
            : "reanalyze"
        );

        if (button.dataset.mode === "full") {
          await runFullPipelinePhase4();
        } else {
          await rerunCurrentListPhase4();
        }
      } catch (error) {
        // 最外層保險：任何未預期錯誤都必須顯示在畫面，
        // 不再讓按鈕看起來像「完全沒反應」。
        console.error(error);
        elements.statusLine.classList.add("error");
        elements.statusText.textContent =
          `按鈕執行失敗：${error?.message || String(error)}`;
        notifyPipelineFailure(error);
        setRunning(false);
      }
    });
  });

  document.addEventListener("mouseover", event => {
    const target = event.target.closest?.(".hover");
    if (!target || target.contains(event.relatedTarget)) return;
    showCard(target);
  });
  document.addEventListener("mouseout", event => {
    const target = event.target.closest?.(".hover");
    if (!target || target.contains(event.relatedTarget)) return;
    hideLater();
  });
  document.addEventListener("focusin", event => {
    const target = event.target.closest?.(".hover");
    if (target) showCard(target);
  });
  document.addEventListener("focusout", event => {
    const target = event.target.closest?.(".hover");
    if (target) hideLater();
  });

  elements.card.addEventListener("mouseenter", cancelClose);
  elements.card.addEventListener("mouseleave", hideLater);
  elements.card.addEventListener("click", event => {
    const tab = event.target.closest(".stats-tab");
    if (!tab) return;
    event.preventDefault();
    const shell = tab.closest(".stats-tabs-shell");
    if (!shell) return;
    const key = tab.dataset.statsTab;
    shell.querySelectorAll(".stats-tab").forEach(item => {
      const active = item === tab;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", active ? "true" : "false");
    });
    shell.querySelectorAll(".stats-tab-panel").forEach(panel => {
      panel.classList.toggle("active", panel.dataset.statsPanel === key);
    });
    requestAnimationFrame(fitIntegratedCardToContent);
  });

  document.addEventListener("click", async event => {
    const button = event.target.closest(".copy-url,.copy-match");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const copied = await copyText(copyValue(button));
    button.classList.toggle("copied", copied);
    if (button.classList.contains("copy-match")) {
      const original = button.dataset.originalHtml || button.innerHTML;
      button.dataset.originalHtml = original;
      button.innerHTML = `<span class="copy-result">${copied ? "✓" : "!"}</span>`;
      setTimeout(() => {
        button.innerHTML = original;
        button.classList.remove("copied");
      }, 1400);
      return;
    }
    const status = button.parentElement.querySelector(".copy-status");
    if (status) {
      status.textContent = copied ? "已複製" : "複製失敗";
      setTimeout(() => {
        status.textContent = "";
        button.classList.remove("copied");
      }, 1600);
    }
  });


  document.addEventListener("click", event => {
    const button = event.target.closest?.(".external-risk-icon[data-risk-item]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const item = String(button.dataset.riskItem || "");
    const row = (Array.isArray(state.analysis?.matches) ? state.analysis.matches : []).find(candidate => String(candidate?.["項次"] ?? "") === item);
    if (!row) return;
    const entry = riskEntryMap().get(geminiClient.externalRiskMatchKey(row));
    if (entry) openRiskDialog(entry);
  });

  document.getElementById("risk-dialog-close").addEventListener("click", () => elements.riskDialog.close());
  elements.riskDialog.addEventListener("click", event => {
    if (event.target === elements.riskDialog) elements.riskDialog.close();
  });

  elements.chatToggle.setAttribute("aria-expanded", "false");
  elements.chatToggle.addEventListener("click", () => {
    setDrawer(!elements.drawer.classList.contains("open"));
  });
  document.getElementById("chat-close").addEventListener("click", () => setDrawer(false));
  document.getElementById("chat-new").addEventListener("click", () => {
    state.chatHistory = [];
    elements.chatLog.innerHTML = "";
    elements.chatWelcome.hidden = false;
    elements.chatLog.appendChild(elements.chatWelcome);
    elements.chatInput.value = "";
    elements.chatInput.focus();
  });
  document.getElementById("chat-settings").addEventListener("click", openGeminiSettings);
  document.getElementById("settings-close").addEventListener("click", () => elements.settingsDialog.close());
  document.getElementById("settings-cancel").addEventListener("click", () => elements.settingsDialog.close());
  document.getElementById("gemini-settings-form").addEventListener("submit", event => {
    event.preventDefault();
    geminiSettings = {
      model:
        document.getElementById(
          "gemini-model"
        ).value.trim() ||
        "gemini-2.5-flash",
      systemPrompt:
        document.getElementById(
          "gemini-system-prompt"
        ).value.trim() ||
        DEFAULT_TENNIS_PROMPT
    };
    persistGeminiSettings();
    document.getElementById("settings-status").textContent = "設定已儲存";
    setTimeout(() => elements.settingsDialog.close(), 250);
  });

  elements.chatSend.addEventListener("click", async () => {
    if (state.generating) return;
    const question = elements.chatInput.value.trim();
    if (!question) return;

    const requestHistory = state.chatHistory.slice(-6);
    state.chatHistory.push({ role: "user", text: question });
    createChatMessage("user", question);
    elements.chatInput.value = "";
    state.generating = true;
    elements.chatSend.disabled = true;
    elements.chatSend.textContent = "分析中…";
    const pending = createChatMessage(
      "model pending",
      "Gemini 正在分析 TennisRatio 資料；需要即時資訊時會使用 Google Search…"
    );

    try {
      const workerToken = configurationValue(
        WORKER_UPLOAD_TOKEN,
        "WORKER_UPLOAD_TOKEN"
      );

      const analysisRows = Array.isArray(state.analysis?.matches)
        ? state.analysis.matches
        : [];
      const result = await geminiClient.ask(question, {
        payload: state.today,
        analysis: state.analysis,
        rows: analysisRows,
        revision: Number(elements.body.dataset.revision || 0),
        history: requestHistory,
        workerUrl: WORKER_URL,
        workerToken,
        model: geminiSettings.model,
        customSystemPrompt: geminiSettings.systemPrompt,
        webGrounding: true
      });

      pending.message.classList.remove("pending");
      const answer = String(result.answer || "");
      await typeAnswer(pending, answer);
      addContextMeta(pending.message, result);
      addSources(
        pending.message,
        result.grounding_sources || [],
        result.web_search_queries || []
      );
      state.chatHistory.push({ role: "model", text: answer });
    } catch (error) {
      pending.message.remove();
      appendError(`Gemini錯誤：${error?.message || String(error)}`);
    } finally {
      state.generating = false;
      elements.chatSend.disabled = false;
      elements.chatSend.textContent = "送出";
      elements.chatInput.focus();
      elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
    }
  });
  elements.chatInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      elements.chatSend.click();
    }
  });

  persistGeminiSettings();
  window.addEventListener("resize", hideCard);
  window.addEventListener("keydown", event => {
    if (event.key === "Escape") hideCard();
  });

  window.TennisRatioApp = {
    reloadData: loadData,
    getAnalysis: () => state.analysis,
    getTodayMatches: () => state.today,
    getSourceBundle: () => state.sourceBundle,
    getExternalRisk: () => state.externalRisk,
    scanExternalRisk: startExternalRiskScan
  };

  window.addEventListener("unhandledrejection", event => {
    const error = event.reason;
    console.error("Unhandled promise rejection", error);
    elements.statusLine.classList.add("error");
    elements.statusText.textContent =
      `未處理的執行錯誤：${error?.message || String(error)}`;
    setRunning(false);
  });

  window.addEventListener("error", event => {
    if (!event.error) return;
    console.error("Runtime error", event.error);
    elements.statusLine.classList.add("error");
    elements.statusText.textContent =
      `JavaScript 執行錯誤：${event.error?.message || event.message}`;
    setRunning(false);
  });

  loadData();
})();
