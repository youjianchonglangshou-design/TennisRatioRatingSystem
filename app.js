(() => {
  "use strict";

  const renderer = window.TennisRatioRenderer;
  const pinnacle = window.TennisRatioPinnacle;
  const r2Client = window.TennisRatioR2Client;
  const sourcePipeline = window.TennisRatioSourcePipeline;
  const analysisEngine = window.TennisRatioAnalysisEngine;
  const learning = window.TennisRatioLearning;
  const aiClient = window.TennisRatioAI;
  if (!renderer) throw new Error("renderer.js 尚未載入。");
  if (!pinnacle) throw new Error("pinnacle.js 尚未載入。");
  if (!r2Client) throw new Error("r2-client.js 尚未載入。");
  if (!sourcePipeline) throw new Error("source-pipeline.js 尚未載入。");
  if (!analysisEngine) throw new Error("analysis-engine.js 尚未載入。");
  if (!learning) throw new Error("learning.js 尚未載入。");
  if (!aiClient) throw new Error("ai-services.js 尚未載入。");

  // ============================================================
  // Gemini 統一由 Cloudflare Worker 代理。
  // 左側問答與上方「分析風險」共用 GEMINI_API_KEY Secret。
  // 前端不再要求或保存 Gemini API Key。
  // ============================================================
  const ARCADIA_API_KEY =
    "CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R";

  const WORKER_URL =
    "https://tennis-json-store.youjianchonglangshou.workers.dev";

  const WORKER_UPLOAD_TOKEN =
    "tennis_upload_2026_xxxxxxxxxxxxxxxx";

  const DATA_BASE_URL = ".";
  const CHAT_SETTINGS_KEY = "tennisratio.ai.settings.v1";
  const LEGACY_GROQ_SETTINGS_KEY = "tennisratio.groq.settings.v1";
  const LEGACY_CHAT_SETTINGS_KEY = "tennisratio.gemini.settings.v1";
  const EXTERNAL_RISK_CACHE_HOURS = 6;
  const GEMINI_USAGE_KEY = "tennisratio.gemini.usage.v1";
  const GEMINI_GROUNDED_DAILY_LIMIT = 500;
  const ANALYSIS_TOAST_DURATION_MS = 18000;
  const LEARNING_LIVE_REFRESH_MS = 2 * 60 * 1000;
  const TELEGRAM_NOTIFY_PATH = "/telegram/notify";
  const FULL_ANALYSIS_AUTH_PATH = "/auth/full-analysis";
  const DEFAULT_TENNIS_PROMPT = "你是一般用途的 Gemini 助理，同時熟悉 TennisRatio 網球賽事分析。使用繁體中文，回答清楚、精確、可覆盤。可以回答一般問題；涉及近期消息時使用 Google Search 並列出來源。以系統提供的 Pinnacle 與 ratio_analysis.json 為主要依據，不捏造賠率、勝率、評級、D值或五項比較。區分『較可能獲勝』與『目前賠率是否值得下注』，不要承諾獲利。";

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
    completionNotificationMode: null,
    learningRefreshTimer: null,
    learningRefreshRunning: false,
    lastRiskDiagnostic: null,
    riskCacheCycleId: null,
    riskCacheCycleAnchorAt: null,
    riskCacheCycleLegacyMode: false,
    fullAnalysisAccessToken: "",
    fullAnalysisAccessExpiresAt: "",
    fullAnalysisAuthResolver: null,
    fullAnalysisAuthVerified: false
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
    geminiUsage: document.getElementById("gemini-global-usage"),
    geminiRpdSummary: document.getElementById("gemini-rpd-summary"),
    geminiUsageHelp: document.getElementById("gemini-usage-help"),
    geminiUsagePopover: document.getElementById("gemini-usage-popover"),
    geminiUsageDetail: document.getElementById("gemini-usage-detail"),
    settingsDialog: document.getElementById("ai-settings-dialog"),
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
    analysisToastClose: document.getElementById("analysis-toast-close"),
    fullAnalysisAuthDialog: document.getElementById("full-analysis-auth-dialog"),
    fullAnalysisAuthForm: document.getElementById("full-analysis-auth-form"),
    fullAnalysisPassword: document.getElementById("full-analysis-password"),
    fullAnalysisPasswordToggle: document.getElementById("full-analysis-password-toggle"),
    fullAnalysisAuthStatus: document.getElementById("full-analysis-auth-status"),
    fullAnalysisAuthSubmit: document.getElementById("full-analysis-auth-submit"),
    fullAnalysisAuthCancel: document.getElementById("full-analysis-auth-cancel"),
    fullAnalysisAuthClose: document.getElementById("full-analysis-auth-close")
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

  function riskCacheInfo(nowMs = Date.now()) {
    return aiClient.riskDocumentCacheInfo(
      state.externalRisk,
      nowMs
    );
  }

  function riskCompletedAt() {
    const info = riskCacheInfo();
    return (
      state.externalRisk?.last_completed_at_taiwan ||
      info.anchorText ||
      state.externalRisk?.generated_at_taiwan ||
      null
    );
  }

  function riskNextRefreshAt() {
    const info = riskCacheInfo();
    return (
      state.externalRisk?.cache_expires_at_taiwan ||
      state.externalRisk?.next_refresh_at_taiwan ||
      info.expiresText ||
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


  function setStatusSegments(element, segments) {
    if (!element) return;
    const fragment = document.createDocumentFragment();

    segments.forEach((segment, index) => {
      if (index > 0) {
        const separator = document.createElement("span");
        separator.className = "risk-separator";
        separator.textContent = "｜";
        fragment.appendChild(separator);
      }

      const node = document.createElement("span");
      node.className = `risk-segment ${segment.className || "risk-segment-muted"}`;
      node.textContent = String(segment.text || "");
      fragment.appendChild(node);
    });

    element.replaceChildren(fragment);
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
      setStatusSegments(
        elements.riskCacheStatus,
        updatedAt
          ? [
              {
                text: `更新 ${taiwanTimeText(updatedAt)}`,
                className: "risk-segment-info"
              },
              {
                text: "本次掃描中",
                className: "risk-segment-next"
              }
            ]
          : [
              {
                text: "首次掃描中",
                className: "risk-segment-next"
              }
            ]
      );
      elements.riskCacheStatus.classList.add(
        "scanning"
      );
      return;
    }

    if (systemErrors > 0) {
      setStatusSegments(elements.riskCacheStatus, [
        {
          text: "API Key 或權限需檢查",
          className: "risk-segment-alert"
        }
      ]);
      elements.riskCacheStatus.classList.add(
        "expired"
      );
      return;
    }

    if (unfinished > 0) {
      setStatusSegments(elements.riskCacheStatus, [
        {
          text: `更新 ${taiwanTimeText(updatedAt)}`,
          className: "risk-segment-info"
        },
        {
          text: `未完成 ${unfinished} 場`,
          className: "risk-segment-alert"
        },
        {
          text: "下次重新分析重試",
          className: "risk-segment-next"
        }
      ]);
      elements.riskCacheStatus.classList.add(
        "expired"
      );
      return;
    }

    const completedAt = riskCompletedAt();
    const nextRefreshAt = riskNextRefreshAt();

    if (!updatedAt) {
      setStatusSegments(elements.riskCacheStatus, [
        {
          text: "更新 尚無資料",
          className: "risk-segment-muted"
        }
      ]);
      return;
    }

    if (!nextRefreshAt) {
      setStatusSegments(elements.riskCacheStatus, [
        {
          text: `更新 ${taiwanTimeText(updatedAt)}`,
          className: "risk-segment-info"
        },
        {
          text: "下次重新分析時檢查",
          className: "risk-segment-next"
        }
      ]);
      return;
    }

    const expired =
      Date.parse(nextRefreshAt) <= Date.now();

    setStatusSegments(elements.riskCacheStatus, [
      {
        text: `更新 ${taiwanTimeText(
          completedAt || updatedAt
        )}`,
        className: "risk-segment-info"
      },
      {
        text: `下次 ${remainingTimeText(
          nextRefreshAt
        )}`,
        className: expired
          ? "risk-segment-alert"
          : "risk-segment-next"
      }
    ]);

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

  function completionModeLabel(mode) {
    return ({
      full: "重新抓取＋完整分析",
      reanalyze: "只重跑目前清單",
      risk: "分析風險"
    })[mode] || "TennisRatio 任務";
  }

  async function sendTelegramNotification(payload) {
    const token = configurationValue(WORKER_UPLOAD_TOKEN, "WORKER_UPLOAD_TOKEN");
    const response = await fetch(`${WORKER_URL}${TELEGRAM_NOTIFY_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { error: text }; }
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.detail || data?.error || `Telegram HTTP ${response.status}`);
    }
    return data;
  }

  function clearPendingCompletionNotification() {
    state.completionNotificationPending = false;
    state.completionNotificationMode = null;
  }

  async function notifyWholeAnalysisComplete({
    usedCache = false,
    failed = false
  } = {}) {
    if (!state.completionNotificationPending) return;

    const mode = state.completionNotificationMode;
    clearPendingCompletionNotification();

    const rows = eligibleRiskRows();
    const entries = Array.isArray(state.externalRisk?.entries) ? state.externalRisk.entries : [];
    const entryMap = new Map(entries.map(entry => [String(entry?.match_key || ""), entry]));

    let riskCount = 0;
    let manualReviewCount = 0;
    let unfinishedCount = 0;
    let systemErrorCount = 0;
    let completedCount = 0;

    for (const row of rows) {
      const entry = entryMap.get(aiClient.externalRiskMatchKey(row));
      const status = aiClient.normalizeRiskStatus(entry?.status);
      if (aiClient.isRiskResolvedStatus(status)) completedCount += 1;
      if (status === "risk_found") riskCount += 1;
      if (status === "manual_review") manualReviewCount += 1;
      if (status === "search_incomplete") unfinishedCount += 1;
      if (status === "system_error") systemErrorCount += 1;
    }

    const modeText = completionModeLabel(mode);
    const cacheText = usedCache
      ? "外部風險沿用 R2 六小時快取。"
      : "外部風險結果已逐場寫入 R2。";
    const message =
      `${modeText}完成｜A/B ${rows.length}場` +
      `｜完成 ${completedCount}/${rows.length}` +
      `｜警示 ${riskCount}` +
      (manualReviewCount ? `｜人工判讀 ${manualReviewCount}` : "") +
      (unfinishedCount ? `｜未完成 ${unfinishedCount}` : "") +
      (systemErrorCount ? `｜系統錯誤 ${systemErrorCount}` : "") +
      `。${cacheText}`;

    const tone = failed || unfinishedCount || systemErrorCount ? "warning" : "success";
    showAnalysisToast(
      failed ? "分析完成，但外部風險有待確認" : "TennisRatio 全部分析完成",
      message,
      tone
    );
    sendSystemNotification(
      failed ? "TennisRatio 完成｜部分風險待確認" : "TennisRatio 全部分析完成",
      message
    );

    const telegramText = [
      "🎾 TennisRatio 2.0",
      `${failed ? "⚠️" : "✅"} ${modeText}完成`,
      `時間：${taiwanTimeText(new Date().toISOString())}`,
      `分析場次：${state.analysis?.matches?.length || 0}`,
      `A／B風險：完成 ${completedCount}/${rows.length}`,
      `警示：${riskCount}｜人工判讀：${manualReviewCount}｜未完成：${unfinishedCount}｜系統錯誤：${systemErrorCount}`,
      cacheText
    ].join("\n");

    try {
      await sendTelegramNotification({
        mode,
        status: failed ? "partial" : "complete",
        text: telegramText
      });
      elements.statusText.textContent = `${elements.statusText.textContent}｜Telegram 已送出`;
    } catch (error) {
      console.error("Telegram 完成通知失敗", error);
      showAnalysisToast(
        "分析已完成｜Telegram 未送出",
        `${message}｜Telegram：${error?.message || String(error)}`,
        "warning"
      );
      elements.statusLine.classList.add("error");
      elements.statusText.textContent = `${elements.statusText.textContent}｜Telegram 通知失敗：${error?.message || String(error)}`;
    }
  }

  async function notifyPipelineFailure(error) {
    if (!state.completionNotificationPending) return;
    const mode = state.completionNotificationMode;
    clearPendingCompletionNotification();
    const message = error?.message || String(error);

    showAnalysisToast("TennisRatio 分析失敗", message, "error");
    sendSystemNotification("TennisRatio 分析失敗", message);

    try {
      await sendTelegramNotification({
        mode,
        status: "failed",
        text: [
          "🎾 TennisRatio 2.0",
          `❌ ${completionModeLabel(mode)}失敗`,
          `時間：${taiwanTimeText(new Date().toISOString())}`,
          `原因：${message}`
        ].join("\n")
      });
    } catch (telegramError) {
      console.error("Telegram 失敗通知也未送出", telegramError);
    }
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

  function setFullAnalysisAuthStatus(message = "", tone = "") {
    const node = elements.fullAnalysisAuthStatus;
    if (!node) return;
    node.textContent = String(message || "");
    node.className = "full-analysis-auth-status";
    if (tone) node.classList.add(tone);
  }

  function finishFullAnalysisAuth(value) {
    const resolver = state.fullAnalysisAuthResolver;
    state.fullAnalysisAuthResolver = null;
    if (typeof resolver === "function") resolver(value || null);
  }

  function closeFullAnalysisAuth(result = null) {
    if (elements.fullAnalysisPassword) {
      elements.fullAnalysisPassword.value = "";
      elements.fullAnalysisPassword.type = "password";
    }
    if (elements.fullAnalysisPasswordToggle) {
      elements.fullAnalysisPasswordToggle.setAttribute("aria-pressed", "false");
    }
    if (elements.fullAnalysisAuthDialog?.open) {
      state.fullAnalysisAuthVerified = Boolean(result);
      elements.fullAnalysisAuthDialog.close();
    } else {
      finishFullAnalysisAuth(result);
    }
  }

  function requestFullAnalysisAuthorization() {
    if (!elements.fullAnalysisAuthDialog) {
      return Promise.reject(new Error("完整分析密碼卡片尚未載入。"));
    }
    if (state.fullAnalysisAuthResolver) {
      return Promise.reject(new Error("完整分析密碼驗證已在進行中。"));
    }
    state.fullAnalysisAccessToken = "";
    state.fullAnalysisAccessExpiresAt = "";
    state.fullAnalysisAuthVerified = false;
    setFullAnalysisAuthStatus(
      "密碼只會送往 Cloudflare Worker 驗證，不會存入瀏覽器。"
    );
    if (elements.fullAnalysisPassword) {
      elements.fullAnalysisPassword.value = "";
      elements.fullAnalysisPassword.type = "password";
    }
    if (elements.fullAnalysisPasswordToggle) {
      elements.fullAnalysisPasswordToggle.setAttribute("aria-pressed", "false");
    }
    elements.fullAnalysisAuthDialog.showModal();
    requestAnimationFrame(() => elements.fullAnalysisPassword?.focus());
    return new Promise(resolve => {
      state.fullAnalysisAuthResolver = resolve;
    });
  }

  async function verifyFullAnalysisPassword(password) {
    const response = await fetch(`${WORKER_URL}${FULL_ANALYSIS_AUTH_PATH}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password }),
      cache: "no-store"
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text };
    }
    if (!response.ok || payload?.ok === false) {
      const error = new Error(
        payload?.error || payload?.detail || `HTTP ${response.status}`
      );
      error.status = response.status;
      error.retryAfterSeconds = Number(
        payload?.retry_after_seconds ||
        response.headers.get("Retry-After") ||
        0
      );
      throw error;
    }
    const token = String(payload?.token || "").trim();
    if (!token) throw new Error("Worker 未回傳完整分析啟動授權。");
    return {
      token,
      expiresAt: String(payload?.expires_at || ""),
      expiresInSeconds: Number(payload?.expires_in_seconds || 0)
    };
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
      !aiClient.isExternalRiskEligible(row)
    ) {
      return null;
    }

    const key =
      aiClient.externalRiskMatchKey(row);
    const entry = riskEntryMap().get(key);

    // 顯示與「是否需要重新呼叫 Gemini」分離。
    // 只要 R2 external_risk.json 中是同一場、同一熱門方、同一風險管線，
    // 即使六小時已過也先顯示最後一次保存結果；六小時只控制下一次按
    // 「分析風險」時是否重新搜尋，不讓重新整理頁面把圖示清空。
    if (entry && aiClient.riskEntryMatchesRow(entry, row)) {
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
      if (!aiClient.isExternalRiskEligible(row)) continue;
      output[String(row?.["項次"] ?? "")] = riskEntryForRow(row);
    }
    return output;
  }

  function eligibleRiskRows() {
    return (Array.isArray(state.analysis?.matches)
      ? state.analysis.matches : [])
      .filter(row => aiClient.isExternalRiskEligible(row));
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
        aiClient.externalRiskMatchKey(row)
      );
      if (entry && aiClient.riskEntryMatchesRow(entry, row)) entries.push(entry);
    }

    const cycleId = String(
      state.riskCacheCycleId ||
      state.externalRisk?.cache_cycle_id ||
      ""
    ).trim() || null;
    const legacyCycle = Boolean(state.riskCacheCycleLegacyMode);
    const cycleMatches = entry =>
      !cycleId ||
      aiClient.riskEntryCacheCycleMatches(
        entry,
        cycleId,
        legacyCycle
      );

    const currentCycleEntries = entries.filter(cycleMatches);
    const resolvedEntries = currentCycleEntries.filter(
      entry => aiClient.isRiskResolvedStatus(entry?.status)
    );
    const incompleteEntries = currentCycleEntries.filter(
      entry => aiClient.normalizeRiskStatus(entry?.status) === "search_incomplete"
    );
    const systemErrorEntries = currentCycleEntries.filter(
      entry => aiClient.normalizeRiskStatus(entry?.status) === "system_error"
    );

    const updatedAt = taipeiIsoText();
    const fullyComplete =
      scanStatus === "complete" &&
      systemErrorEntries.length === 0 &&
      resolvedEntries.length === rows.length;

    const previousCompletedAt =
      state.externalRisk?.last_completed_at_taiwan || null;
    const lastCompletedAt = fullyComplete ? updatedAt : previousCompletedAt;

    const anchorAt =
      state.riskCacheCycleAnchorAt ||
      state.externalRisk?.cache_anchor_at_taiwan ||
      null;
    const cacheExpiresAt = anchorAt
      ? addHoursIso(anchorAt, EXTERNAL_RISK_CACHE_HOURS)
      : null;

    const cycleProcessedCount = currentCycleEntries.length;
    const unfinishedCount = Math.max(
      0,
      rows.length - resolvedEntries.length - systemErrorEntries.length
    );

    return {
      version: "external-risk-v1.4-r2-shared-cache",
      generated_at_taiwan: updatedAt,
      updated_at_taiwan: updatedAt,
      last_completed_at_taiwan: lastCompletedAt,
      next_refresh_at_taiwan: cacheExpiresAt,
      cache_cycle_id: cycleId,
      cache_anchor_at_taiwan: anchorAt,
      cache_expires_at_taiwan: cacheExpiresAt,
      cache_scope: "shared_r2_ab_cycle",
      cache_policy: {
        resolved_hours: 6,
        risk_found_hours: 6,
        clear_hours: 6,
        manual_review_hours: 6,
        search_incomplete_hours: 0,
        system_error_hours: 0,
        rule: "R2共用六小時；resolved沿用，search_incomplete/system_error每次可重試"
      },
      display_policy: {
        risk_found: "red_double_exclamation",
        clear: "no_icon",
        manual_review: "blue_gray_information",
        search_incomplete: "gray_retry",
        system_error: "header_only",
        stale_resolved: "keep_last_saved_result_until_rescan"
      },
      analysis_generated_at: state.analysis?.generated_at_taiwan ?? null,
      scan_status:
        systemErrorEntries.length
          ? "system_error"
          : (unfinishedCount > 0 ? "partial" : scanStatus),
      scan_total: rows.length,
      scan_processed_in_cycle: cycleProcessedCount,
      scan_completed: resolvedEntries.length,
      scan_unfinished: unfinishedCount,
      system_error_count: systemErrorEntries.length,
      risk_found_count: resolvedEntries.filter(
        item => aiClient.normalizeRiskStatus(item?.status) === "risk_found"
      ).length,
      clear_count: resolvedEntries.filter(
        item => aiClient.normalizeRiskStatus(item?.status) === "clear"
      ).length,
      manual_review_count: resolvedEntries.filter(
        item => aiClient.normalizeRiskStatus(item?.status) === "manual_review"
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
        aiClient.externalRiskMatchKey(row)
      );
      if (!entry) continue;

      const status =
        aiClient.normalizeRiskStatus(
          entry.status
        );

      if (
        aiClient.isRiskResolvedStatus(
          status
        ) &&
        aiClient.isRiskCacheFresh(
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
      setStatusSegments(elements.riskStatus, [
        {
          text: "● 風險掃描",
          className: "risk-segment-success"
        },
        {
          text: "無 A／B 待掃描",
          className: "risk-segment-muted"
        }
      ]);
      elements.riskStatus.classList.add(
        "complete"
      );
      return;
    }

    if (systemErrors > 0) {
      setStatusSegments(elements.riskStatus, [
        {
          text: "● 風險掃描系統錯誤",
          className: "risk-segment-alert"
        },
        {
          text: `已完成 ${resolved}/${rows.length}`,
          className: "risk-segment-muted"
        }
      ]);
      elements.riskStatus.classList.add(
        "warning"
      );
      return;
    }

    if (state.riskScanning) {
      const segments = [
        {
          text: `● 風險掃描 ${processed}/${rows.length}`,
          className: "risk-segment-info"
        }
      ];
      if (risks) {
        segments.push({
          text: `!! 警示 ${risks}`,
          className: "risk-segment-alert"
        });
      }
      if (manualReviews) {
        segments.push({
          text: `人工判讀 ${manualReviews}`,
          className: "risk-segment-review"
        });
      }
      if (incomplete) {
        segments.push({
          text: `未完成 ${incomplete}`,
          className: "risk-segment-muted"
        });
      }
      setStatusSegments(elements.riskStatus, segments);
      elements.riskStatus.classList.add(
        "scanning"
      );
      return;
    }

    if (
      resolved === rows.length &&
      incomplete === 0
    ) {
      const segments = [
        {
          text: `● 風險掃描 ${resolved}/${rows.length}`,
          className: "risk-segment-success"
        },
        {
          text: `!! 警示 ${risks}`,
          className: risks
            ? "risk-segment-alert"
            : "risk-segment-muted"
        }
      ];
      if (manualReviews) {
        segments.push({
          text: `人工判讀 ${manualReviews}`,
          className: "risk-segment-review"
        });
      }
      setStatusSegments(elements.riskStatus, segments);
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

    const segments = [
      {
        text: `● 風險掃描 ${resolved}/${rows.length}`,
        className: resolved
          ? "risk-segment-success"
          : "risk-segment-muted"
      },
      {
        text: `!! 警示 ${risks}`,
        className: risks
          ? "risk-segment-alert"
          : "risk-segment-muted"
      }
    ];
    if (manualReviews) {
      segments.push({
        text: `人工判讀 ${manualReviews}`,
        className: "risk-segment-review"
      });
    }
    segments.push({
      text: `未完成 ${incomplete}`,
      className: "risk-segment-muted"
    });
    setStatusSegments(elements.riskStatus, segments);

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
      aiClient.normalizeRiskStatus(
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


  function stripRiskCodeWrapper(value) {
    let text = String(value || "").trim();

    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    if (/^json\s*[\r\n]+/i.test(text)) {
      text = text.replace(/^json\s*[\r\n]+/i, "");
    }

    return text.trim();
  }

  function parseEmbeddedRiskJson(value) {
    const text = stripRiskCodeWrapper(value);
    if (!text) return null;

    const candidates = [text];
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (
      firstBrace >= 0 &&
      lastBrace > firstBrace
    ) {
      candidates.push(
        text.slice(firstBrace, lastBrace + 1)
      );
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          return parsed;
        }
      } catch {
        // Continue with the next candidate.
      }
    }

    return null;
  }

  function readableRiskSearchText(value) {
    const original =
      stripRiskCodeWrapper(value);
    if (!original) return "";

    const parsed =
      parseEmbeddedRiskJson(original);

    if (!parsed) {
      return original
        .replace(/^\s*["']?(status|severity|confidence)["']?\s*:\s*.+$/gim, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    const lines = [];
    const findings = Array.isArray(
      parsed.findings
    )
      ? parsed.findings
      : (
          Array.isArray(parsed.evidence)
            ? parsed.evidence
            : []
        );

    if (findings.length) {
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
    }

    if (!lines.length && parsed.summary) {
      lines.push(
        String(parsed.summary).trim()
      );
    }

    if (parsed.impact) {
      lines.push(
        `與本場可能關係：${
          String(parsed.impact).trim()
        }`
      );
    }

    if (parsed.notes) {
      lines.push(
        `補充：${String(parsed.notes).trim()}`
      );
    }

    if (
      !lines.length &&
      parsed.raw_summary
    ) {
      lines.push(
        String(parsed.raw_summary).trim()
      );
    }

    return lines
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function openRiskDialog(entry) {
    const status =
      aiClient.normalizeRiskStatus(
        entry?.status
      );

    if (
      !entry ||
      entry.status === "pending"
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
                : (status === "system_error" ? "risk-system" : status)
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
                : (status === "system_error" ? "risk-system" : status)
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

    if (entry.diagnostic_title || Array.isArray(entry.diagnostic_lines)) {
      const diagnosticSection = document.createElement("section");
      diagnosticSection.className = "risk-section risk-diagnostic";
      const diagnosticTitle = document.createElement("h3");
      diagnosticTitle.textContent = entry.diagnostic_title || "系統診斷";
      diagnosticSection.appendChild(diagnosticTitle);
      const diagnosticList = document.createElement("ul");
      diagnosticList.className = "risk-diagnostic-list";
      const lines = Array.isArray(entry.diagnostic_lines) ? entry.diagnostic_lines : [];
      for (const line of lines) {
        if (!String(line || "").trim()) continue;
        const item = document.createElement("li");
        item.textContent = String(line);
        diagnosticList.appendChild(item);
      }
      if (entry.retry_after_seconds != null) {
        const item = document.createElement("li");
        item.textContent = `建議等待：${entry.retry_after_seconds} 秒`;
        diagnosticList.appendChild(item);
      }
      if (entry.scan_total != null) {
        const item = document.createElement("li");
        item.textContent =
          `掃描進度：已保存 ${Number(entry.scan_saved || 0)}/${Number(entry.scan_total || 0)}` +
          `｜未完成 ${Number(entry.scan_remaining || 0)} 位`;
        diagnosticList.appendChild(item);
      }
      if (entry.scan_current_player) {
        const item = document.createElement("li");
        item.textContent = `目前球員：${entry.scan_current_player}`;
        diagnosticList.appendChild(item);
      }
      if (entry.retry_count != null) {
        const item = document.createElement("li");
        item.textContent = `已重試：${entry.retry_count} 次`;
        diagnosticList.appendChild(item);
      }
      diagnosticSection.appendChild(diagnosticList);
      body.appendChild(diagnosticSection);
    }

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
        "搜尋資訊整理";
      section.appendChild(title);

      const raw =
        document.createElement("div");
      raw.className =
        "risk-raw-search";
      raw.textContent =
        readableRiskSearchText(
          entry.raw_search_text
        );
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
      `｜模型：${entry.model || "—"}` +
      (entry.http_status ? `｜HTTP：${entry.http_status}` : "") +
      (entry.failure_type ? `｜錯誤類型：${entry.failure_type}` : "");
    body.appendChild(meta);

    const disclaimer =
      document.createElement("div");
    disclaimer.className =
      "risk-disclaimer";

    if (status === "manual_review") {
      disclaimer.textContent =
        "灰藍色 i 代表已找到資訊，但不由系統武斷決定。請閱讀上方內容與來源，自行判斷是否影響本場。";
    } else if (status === "system_error") {
      disclaimer.textContent =
        "這是系統或 API 設定問題，不是球員風險。請依上方診斷修正後再執行。";
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
      await notifyWholeAnalysisComplete({
        usedCache: true
      });
      return;
    }

    let existingEntries = Array.isArray(
      state.externalRisk?.entries
    )
      ? state.externalRisk.entries
      : [];

    const sharedCache = riskCacheInfo();
    const reuseResolvedCache = Boolean(sharedCache.fresh);
    const hadExplicitCycle = Boolean(
      String(state.externalRisk?.cache_cycle_id || "").trim()
    );

    // 六小時仍有效：沿用同一 cache cycle。
    // 六小時已過：建立新的 cycle，所有 A/B 都必須重新搜尋。
    if (reuseResolvedCache) {
      state.riskCacheCycleId =
        String(state.externalRisk?.cache_cycle_id || "").trim() ||
        `legacy-${Math.max(0, Number(sharedCache.anchorMs || Date.now()))}`;
      state.riskCacheCycleAnchorAt = sharedCache.anchorText || null;
      state.riskCacheCycleLegacyMode = !hadExplicitCycle;

      // 舊版 external_risk 沒有 cache_cycle_id。只在「仍位於原六小時內」時
      // 將既有 resolved 結果歸入同一 legacy cycle；不會跨過期邊界沿用。
      if (!hadExplicitCycle) {
        existingEntries = existingEntries.map(entry =>
          aiClient.isRiskResolvedStatus(entry?.status)
            ? { ...entry, cache_cycle_id: state.riskCacheCycleId }
            : entry
        );
        state.externalRisk = {
          ...(state.externalRisk || {}),
          cache_cycle_id: state.riskCacheCycleId,
          cache_anchor_at_taiwan: state.riskCacheCycleAnchorAt,
          cache_expires_at_taiwan: sharedCache.expiresText || null,
          entries: existingEntries
        };
        state.riskCacheCycleLegacyMode = false;
      }
    } else {
      state.riskCacheCycleId =
        `risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      state.riskCacheCycleAnchorAt = null;
      state.riskCacheCycleLegacyMode = false;
    }

    const cycleId = state.riskCacheCycleId;
    const oldMap = new Map(
      existingEntries.map(entry => [
        String(entry?.match_key || ""),
        entry
      ])
    );
    const staleRows = rows.filter(row => {
      if (!reuseResolvedCache) return true;
      const entry = oldMap.get(aiClient.externalRiskMatchKey(row));
      return !(
        aiClient.isRiskResolvedStatus(entry?.status) &&
        aiClient.riskEntryMatchesRow(entry, row) &&
        aiClient.riskEntryCacheCycleMatches(entry, cycleId, false)
      );
    });

    if (!staleRows.length) {
      updateRiskStatus();
      await notifyWholeAnalysisComplete({
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
          aiClient.compactRiskMatch(row);
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
          diagnostic_title: "⛔ Worker Token 尚未設定",
          diagnostic_lines: [
            "請在 app.js 填入 WORKER_UPLOAD_TOKEN。",
            "這是系統驗證設定問題，不是球員風險。",
            "本輪掃描已停止，不會自動重試。"
          ],
          retryable: false,
          stop_batch: true,
          quota_kind: null,
          http_status: null,
          retry_after_seconds: null,
          cache_hours: 0,
          cache_until: null,
          used_cache: false,
          technical_error: error.message,
          sources: [],
          checked_at: new Date().toISOString(),
          model: aiClient.RISK_MODEL
        };
        mergeRiskEntry(entry);
        refreshRiskSlot(row?.["項次"], entry);
      }
      updateRiskStatus();
      state.lastRiskDiagnostic = staleRows.length ? riskEntryMap().get(aiClient.externalRiskMatchKey(staleRows[0])) || null : null;
      await notifyWholeAnalysisComplete({
        usedCache: false,
        failed: true
      });
      return;
    }

    const riskUsageOperationId = beginGeminiUsageOperation(
      "risk",
      `risk-${Date.now()}-${generation}`,
      `準備掃描 ${staleRows.length} 場`
    );

    state.riskScanning = true;
    updateRiskStatus();

    let scanFailed = false;

    try {
      const result =
        await aiClient.scanExternalRisks(
          rows,
          {
            existingEntries,
            reuseResolvedCache,
            cacheCycleId: cycleId,
            allowLegacyCacheCycle: false,
            workerUrl: WORKER_URL,
            workerToken,
            delayMinMs: 30000,
            delayMaxMs: 35000,
            onQueueState: async info => {
              if (generation !== state.riskScanGeneration) throw new Error("RISK_SCAN_SUPERSEDED");
              if (info.state === "queued") {
                elements.statusText.textContent =
                  `Gemini 共用佇列｜風險搜尋等待中` +
                  `｜前方 ${info.position || 1} 個請求`;
              }
            },
            onPending: async (row, progress) => {
              if (
                generation !==
                state.riskScanGeneration
              ) {
                throw new Error(
                  "RISK_SCAN_SUPERSEDED"
                );
              }
              elements.statusText.textContent =
                `外部風險覆核｜準備搜尋 ${progress.completed + 1}/${progress.total}` +
                `｜熱門方 ${row?.熱門方 || "—"}`;
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

              // 只有真正新呼叫 Gemini 且得到 resolved 結果，才推進整批六小時快取起點。
              // 失敗重試不會把舊的 resolved 結果無限延長。
              if (
                !progress.fromCache &&
                aiClient.isRiskResolvedStatus(entry?.status)
              ) {
                state.riskCacheCycleAnchorAt =
                  taipeiIsoText(entry?.checked_at || Date.now());
                entry = {
                  ...entry,
                  cache_cycle_id: cycleId
                };
              }

              mergeRiskEntry(entry);
              if (aiClient.isRiskFailureStatus(entry?.status)) {
                state.lastRiskDiagnostic = entry;
              }
              refreshRiskSlot(entry.item, entry);
              updateRiskStatus();

              if (
                !progress.fromCache &&
                entry?.search_completed &&
                entry?.usage &&
                Object.keys(entry.usage).length
              ) {
                recordGeminiUsage(entry.usage, {
                  grounded: true,
                  kind: "risk",
                  operationId: riskUsageOperationId
                });
                updateGeminiUsageOperationNote(
                  riskUsageOperationId,
                  `${progress.completed}/${progress.total} 場`
                );
              }

              try {
                await persistExternalRisk("running");
              } catch (error) {
                console.error(
                  "external_risk 暫存失敗",
                  error
                );
              }

              elements.statusText.textContent =
                `外部風險覆核｜已處理 ` +
                `${progress.completed}/${progress.total}` +
                `｜熱門方 ${entry.hot_player}` +
                `｜${riskStatusLabel(entry)}`;
            },
            onCooldown: async info => {
              if (generation !== state.riskScanGeneration) throw new Error("RISK_SCAN_SUPERSEDED");
              elements.statusText.textContent =
                `外部風險覆核｜已保存 ${info.completed}/${info.total}` +
                `｜下一位 ${info.nextRow?.熱門方 || "—"}` +
                `｜安全冷卻 ${info.remainingSeconds} 秒`;
            },
            onRetryWait: async (entry, info) => {
              if (generation !== state.riskScanGeneration) throw new Error("RISK_SCAN_SUPERSEDED");
              state.lastRiskDiagnostic = entry;
              const kind = entry.quota_kind || entry.failure_type || `HTTP ${entry.http_status || "—"}`;
              elements.statusText.textContent =
                `Gemini ${kind} 暫停｜${info.remainingSeconds} 秒後重試` +
                `｜目前球員 ${info.row?.熱門方 || "—"}` +
                `｜已保存 ${info.completed}/${info.total}`;
            },
            onStop: async (entry, info) => {
              state.lastRiskDiagnostic = entry;
              elements.statusLine.classList.add("error");
              elements.statusText.textContent =
                `${entry.diagnostic_title || entry.summary || "Gemini 掃描停止"}` +
                `｜已保存 ${info.completed}/${info.total}` +
                `｜未完成 ${info.remaining}` +
                `｜點擊右側風險狀態查看診斷`;
              if (!elements.riskDialog.open) openRiskDialog(entry);
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
          aiClient.normalizeRiskStatus(
            entry?.status
          ) === "system_error"
        );

      const refreshedResolved = result.entries.some(entry =>
        aiClient.isRiskResolvedStatus(entry?.status) &&
        entry?.used_cache === false &&
        String(entry?.cache_cycle_id || "") === String(cycleId || "")
      );
      if (refreshedResolved) {
        // 使用整批最後一次成功更新時間作為共享六小時起點。
        state.riskCacheCycleAnchorAt = taipeiIsoText();
      }

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
        result.unresolved > 0 ||
        result.stoppedEarly;
      if (result.stopEntry) state.lastRiskDiagnostic = result.stopEntry;
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

        await notifyWholeAnalysisComplete({
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


  async function runRiskAnalysisPhase({
    reloadRatioFromR2 = false,
    refreshTable = false
  } = {}) {
    cancelExternalRiskScan();

    if (reloadRatioFromR2) {
      elements.statusText.textContent =
        "分析風險｜正在從 R2 讀取 ratio_analysis.json 與 external_risk.json……";

      const [
        analysis,
        externalRisk,
        today
      ] = await Promise.all([
        fetchLatestAnalysis(),
        fetchLatestExternalRisk(),
        (
          state.today
            ? Promise.resolve(state.today)
            : fetchLatestTodayMatches()
        ).catch(() => state.today || null)
      ]);

      state.analysis = analysis;
      state.externalRisk = externalRisk;

      if (today) {
        updateTodayState(today);
      }

      if (refreshTable) {
        renderAnalysis(
          analysis,
          today || state.today || {}
        );
      }
    } else {
      // 前面分析已產生新的 ratio_analysis.json。
      // 此處只同步 R2 外部風險快取，不重新呼叫
      // Arcadia、365Scores 或 TennisRatio。
      const latestRisk =
        await fetchLatestExternalRisk();

      if (latestRisk) {
        state.externalRisk = latestRisk;
      }

      updateRiskStatus();
    }

    if (
      !state.analysis ||
      !Array.isArray(state.analysis.matches)
    ) {
      throw new Error(
        "R2 ratio_analysis.json 沒有可供風險分析的比賽資料。"
      );
    }

    elements.statusLine.classList.remove(
      "error"
    );
    elements.statusText.textContent =
      `分析風險｜已讀取 ratio_analysis ` +
      `${state.analysis.matches.length} 場；` +
      `正在檢查 A／B 熱門方與 R2 六小時快取……`;

    await startExternalRiskScan();
    return state.externalRisk;
  }

  async function runRiskOnlyFromR2() {
    setRunning(true);
    elements.statusLine.classList.remove(
      "error"
    );

    try {
      configurationValue(
        WORKER_UPLOAD_TOKEN,
        "WORKER_UPLOAD_TOKEN"
      );

      await runRiskAnalysisPhase({
        reloadRatioFromR2: true,
        refreshTable: true
      });
    } catch (error) {
      console.error(error);
      elements.statusLine.classList.add(
        "error"
      );
      elements.statusText.textContent =
        `分析風險失敗：${
          error?.message || String(error)
        }`;
      await notifyPipelineFailure(error);
    } finally {
      setRunning(false);
    }
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

    let analysis = await analysisEngine.buildAnalysis(
      sourceBundle,
      state.config,
      {
        progress: message => {
          elements.statusText.textContent = message;
        }
      }
    );

    elements.statusText.textContent =
      `Phase 4｜已完成 ${analysis.matches.length} 場Formula B；正在讀取Learning正式模型……`;
    analysis = await learning.applyToAnalysis(analysis, WORKER_URL);

    elements.statusText.textContent =
      `Phase 4｜Learning欄位已建立；正在寫入 R2 最新檔＋永久時間戳快照……`;
    const uploadResult = await r2Client.uploadAnalysis(
      WORKER_URL,
      uploadToken,
      analysis
    );
    const savedAnalysis =
      await r2Client.fetchJson(
        WORKER_URL,
        "ratio_analysis.json"
      );
    state.analysis = savedAnalysis;
    renderAnalysis(
      savedAnalysis,
      state.today
    );

    const health =
      savedAnalysis.run_health || {};
    const ratings =
      health.rating_counts || {};

    elements.statusText.textContent =
      `Phase 4完成｜ratio_analysis ` +
      `${savedAnalysis.matches?.length || 0} 場｜` +
      `A ${ratings.A || 0}｜` +
      `B ${ratings.B || 0}｜` +
      `C ${ratings.C || 0}｜` +
      `淘汰 ${
        ratings["淘汰"] ||
        ratings["淘汰＋過期"] ||
        0
      }｜R2 ${
        uploadResult.ratioAnalysisBytes || 0
      } bytes｜快照 ${uploadResult.analysisSnapshotKey || "已建立"}｜準備執行分析風險`;

    // 完整分析與目前清單重跑，最後都進入
    // 與「分析風險」按鈕相同的共用流程。
    await runRiskAnalysisPhase({
      reloadRatioFromR2: false,
      refreshTable: false
    });

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

  async function runFullPipelinePhase4(fullAnalysisToken) {
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
        { matchups, markets, todayMatches: today },
        { fullAnalysisToken }
      );
      // 啟動授權只用於本次完整分析的第一個受保護寫入。
      state.fullAnalysisAccessToken = "";
      state.fullAnalysisAccessExpiresAt = "";

      const savedToday = await r2Client.fetchJson(WORKER_URL, "today_matches.json");
      updateTodayState(savedToday);

      await runSourcePhase4(savedToday, uploadToken);
    } catch (error) {
      console.error(error);
      elements.statusLine.classList.add("error");
      elements.statusText.textContent =
        `完整分析執行失敗：${error.message}`;
      await notifyPipelineFailure(error);
    } finally {
      state.fullAnalysisAccessToken = "";
      state.fullAnalysisAccessExpiresAt = "";
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
      await notifyPipelineFailure(error);
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

    elements.chatToggle.disabled = false;
    elements.chatToggle.title = rows.length
      ? "Gemini 網路問答已就緒；已載入 TennisRatio 分析資料"
      : "Gemini 網路問答已就緒；目前沒有 TennisRatio 分析資料";
    const chatContextText = document.getElementById("chat-context-text");
    if (chatContextText) {
      chatContextText.innerHTML = rows.length
        ? `Gemini 2.5 Flash｜Google Search 可用｜分析資料 <b>${rows.length} 場</b>`
        : "Gemini 2.5 Flash｜Google Search 可用｜分析資料尚未載入";
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
    elements.chatToggle.disabled = running;
    elements.chatToggle.title = running
      ? "分析進行中，AI助理暫不可用"
      : "Gemini 網路問答已就緒";
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


  function normalizeSavedAiModel() {
    return aiClient.CHAT_MODEL;
  }

  function aiModelLabel() {
    return aiClient.CHAT_MODEL;
  }

  function loadAiSettings() {
    const defaults = {
      model: aiClient.CHAT_MODEL,
      systemPrompt: DEFAULT_TENNIS_PROMPT
    };

    try {
      const raw =
        localStorage.getItem(CHAT_SETTINGS_KEY) ||
        localStorage.getItem(LEGACY_GROQ_SETTINGS_KEY) ||
        localStorage.getItem(LEGACY_CHAT_SETTINGS_KEY) ||
        "{}";
      const saved = JSON.parse(raw);
      return {
        model: aiClient.CHAT_MODEL,
        systemPrompt:
          String(saved.systemPrompt || defaults.systemPrompt).trim() ||
          defaults.systemPrompt
      };
    } catch {
      return defaults;
    }
  }

  let aiSettings = loadAiSettings();

  function persistAiSettings() {
    localStorage.setItem(
      CHAT_SETTINGS_KEY,
      JSON.stringify({
        model: aiClient.CHAT_MODEL,
        systemPrompt: aiSettings.systemPrompt
      })
    );
    document.getElementById("chat-model-label").textContent =
      `${aiModelLabel(aiSettings.model)}｜Google Search`;
  }

  function setDrawer(open) {
    elements.drawer.classList.toggle("open", open);
    elements.drawer.setAttribute("aria-hidden", open ? "false" : "true");
    elements.chatToggle.classList.toggle("active", open);
    elements.chatToggle.setAttribute("aria-expanded", open ? "true" : "false");
    hideCard();
    if (open) {
      setTimeout(() => elements.chatInput.focus(), 230);
    }
  }

  function openAiSettings() {
    document.getElementById("ai-model").value =
      normalizeSavedAiModel(aiSettings.model);

    document.getElementById("ai-system-prompt").value =
      aiSettings.systemPrompt || DEFAULT_TENNIS_PROMPT;

    document.getElementById("settings-status").textContent =
      "已共用 Cloudflare GEMINI_API_KEY Secret";

    elements.settingsDialog.showModal();
  }

  function geminiQuotaDateKey(value = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(value);
  }

  function timeZoneOffsetMs(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const map = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    const asUtc = Date.UTC(
      Number(map.year), Number(map.month) - 1, Number(map.day),
      Number(map.hour), Number(map.minute), Number(map.second)
    );
    return asUtc - date.getTime();
  }

  function nextPacificMidnight(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);
    const map = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    const localMidnightAsUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day) + 1, 0, 0, 0);
    let targetMs = localMidnightAsUtc;
    for (let index = 0; index < 3; index += 1) {
      targetMs = localMidnightAsUtc - timeZoneOffsetMs(new Date(targetMs), "America/Los_Angeles");
    }
    return new Date(targetMs);
  }

  function countdownText(milliseconds) {
    const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}小時${minutes}分`;
  }

  function taiwanResetClock(date) {
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(date);
  }

  function emptyGeminiUsage() {
    return {
      date: geminiQuotaDateKey(),
      requests: 0,
      grounded_requests: 0,
      prompt_tokens: 0,
      output_tokens: 0,
      thought_tokens: 0,
      tool_tokens: 0,
      total_tokens: 0,
      chat_requests: 0,
      risk_requests: 0,
      last: null,
      last_operation: null
    };
  }

  function loadGeminiUsage() {
    try {
      const parsed = JSON.parse(localStorage.getItem(GEMINI_USAGE_KEY) || "{}");
      if (parsed?.date !== geminiQuotaDateKey()) return emptyGeminiUsage();
      return { ...emptyGeminiUsage(), ...parsed };
    } catch {
      return emptyGeminiUsage();
    }
  }

  let geminiUsage = loadGeminiUsage();

  function usageNumber(usage, key) {
    const value = Number(usage?.[key] || 0);
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  }

  function beginGeminiUsageOperation(kind, operationId, note = "") {
    const id = String(operationId || `${kind}-${Date.now()}`);
    geminiUsage.last_operation = {
      id,
      kind: kind === "risk" ? "risk" : "chat",
      requests: 0,
      prompt_tokens: 0,
      output_tokens: 0,
      thought_tokens: 0,
      tool_tokens: 0,
      total_tokens: 0,
      note: String(note || ""),
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    localStorage.setItem(GEMINI_USAGE_KEY, JSON.stringify(geminiUsage));
    renderGeminiUsage();
    return id;
  }

  function updateGeminiUsageOperationNote(operationId, note) {
    if (geminiUsage.last_operation?.id !== operationId) return;
    geminiUsage.last_operation.note = String(note || "");
    geminiUsage.last_operation.updated_at = new Date().toISOString();
    localStorage.setItem(GEMINI_USAGE_KEY, JSON.stringify(geminiUsage));
    renderGeminiUsage();
  }

  function renderGeminiUsage() {
    if (!elements.geminiUsage) return;
    if (geminiUsage.date !== geminiQuotaDateKey()) {
      geminiUsage = emptyGeminiUsage();
      localStorage.setItem(GEMINI_USAGE_KEY, JSON.stringify(geminiUsage));
    }

    const now = new Date();
    const resetAt = nextPacificMidnight(now);
    const remaining = Math.max(0, GEMINI_GROUNDED_DAILY_LIMIT - Number(geminiUsage.grounded_requests || 0));
    const operation = geminiUsage.last_operation && typeof geminiUsage.last_operation === "object"
      ? geminiUsage.last_operation
      : null;
    const operationKind = operation?.kind === "risk" ? "風險" : "問答";
    const operationRequests = Number(operation?.requests || 0);
    const operationTokens = Number(operation?.total_tokens || 0);
    const operationNote = String(operation?.note || "").trim();
    const operationText = operation
      ? `本次${operationKind} ${operationRequests} 次｜${operationTokens.toLocaleString()} tokens${operationNote ? `｜${operationNote}` : ""}`
      : "本次尚無 API 用量";

    if (elements.geminiRpdSummary) {
      elements.geminiRpdSummary.innerHTML =
        `Google Search RPD 本頁估算剩餘 <strong>${remaining}/${GEMINI_GROUNDED_DAILY_LIMIT}</strong>` +
        `｜台灣 ${taiwanResetClock(resetAt)} 重置｜倒數 <strong class="gemini-reset-countdown">${countdownText(resetAt - now)}</strong>`;
    }

    if (elements.geminiUsageDetail) {
      elements.geminiUsageDetail.innerHTML =
        `${operationText}｜今日 ${Number(geminiUsage.requests || 0)} 次 ` +
        `問答${Number(geminiUsage.chat_requests || 0)}／風險${Number(geminiUsage.risk_requests || 0)}` +
        `｜累計 <strong>${Number(geminiUsage.total_tokens || 0).toLocaleString()} tokens</strong>`;
    }

    elements.geminiUsage.title =
      "點擊紅色問號查看本次與今日用量。Token 來自 Gemini usageMetadata；RPD 剩餘量是本瀏覽器對本頁成功呼叫的本機估算。";
  }

  function recordGeminiUsage(usage, options = {}) {
    if (!usage || typeof usage !== "object") return;
    if (geminiUsage.date !== geminiQuotaDateKey()) geminiUsage = emptyGeminiUsage();

    const kind = options.kind === "risk" ? "risk" : "chat";
    const operationId = String(options.operationId || `${kind}-${Date.now()}`);
    if (geminiUsage.last_operation?.id !== operationId) {
      beginGeminiUsageOperation(kind, operationId);
    }
    const operation = geminiUsage.last_operation;

    const promptTokens = usageNumber(usage, "promptTokenCount");
    const outputTokens = usageNumber(usage, "candidatesTokenCount");
    const thoughtTokens = usageNumber(usage, "thoughtsTokenCount");
    const toolTokens = usageNumber(usage, "toolUsePromptTokenCount");
    const totalTokens = usageNumber(usage, "totalTokenCount");

    geminiUsage.requests += 1;
    if (options.grounded) geminiUsage.grounded_requests += 1;
    if (kind === "risk") geminiUsage.risk_requests += 1;
    else geminiUsage.chat_requests += 1;
    geminiUsage.prompt_tokens += promptTokens;
    geminiUsage.output_tokens += outputTokens;
    geminiUsage.thought_tokens += thoughtTokens;
    geminiUsage.tool_tokens += toolTokens;
    geminiUsage.total_tokens += totalTokens;
    geminiUsage.last = {
      at: new Date().toISOString(),
      kind,
      usage
    };

    operation.requests += 1;
    operation.prompt_tokens += promptTokens;
    operation.output_tokens += outputTokens;
    operation.thought_tokens += thoughtTokens;
    operation.tool_tokens += toolTokens;
    operation.total_tokens += totalTokens;
    operation.updated_at = new Date().toISOString();

    localStorage.setItem(GEMINI_USAGE_KEY, JSON.stringify(geminiUsage));
    renderGeminiUsage();
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
    const modeLabels = {
      general_web_chat: "一般 Gemini 網路問答",
      selected_matches_compact: "指定場次精簡資料",
      compact_overview: "全部場次精簡總覽"
    };
    const mode = modeLabels[result.context_mode] || "Gemini 精簡資料";
    const retryText = result.retry_count
      ? `｜重試 ${result.retry_count} 次`
      : "";
    const bytesText = Number.isFinite(Number(result.request_bytes))
      ? `｜請求 ${(Number(result.request_bytes) / 1024).toFixed(1)} KB`
      : "";
    const connectionText = result.connection_mode === "cloudflare_worker_secret"
      ? "｜Worker 共用 Secret"
      : result.connection_mode === "browser_direct"
        ? "｜瀏覽器直連"
        : "";
    meta.textContent =
      `本次上下文：${mode}｜傳送 ${result.sent_match_count || 0}/${result.total_match_count || 0} 場` +
      `${bytesText}${connectionText}${retryText}`;
    message.appendChild(meta);

    const usage = result.usage || {};
    const total = usageNumber(usage, "totalTokenCount");
    if (total > 0) {
      const tokenMeta = document.createElement("div");
      tokenMeta.className = "chat-meta";
      tokenMeta.textContent =
        `Token：輸入 ${usageNumber(usage, "promptTokenCount").toLocaleString()}` +
        `｜輸出 ${usageNumber(usage, "candidatesTokenCount").toLocaleString()}` +
        `｜思考 ${usageNumber(usage, "thoughtsTokenCount").toLocaleString()}` +
        `｜工具 ${usageNumber(usage, "toolUsePromptTokenCount").toLocaleString()}` +
        `｜總計 ${total.toLocaleString()}`;
      message.appendChild(tokenMeta);
    }
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

  async function refreshLearningDisplay({ force = false } = {}) {
    if (state.learningRefreshRunning) return;
    if (!state.analysis || !Array.isArray(state.analysis.matches)) return;
    if (!force && document.hidden) return;
    if (!force && document.querySelector(".run-button:disabled")) return;

    state.learningRefreshRunning = true;
    try {
      const beforeVersion = String(state.analysis?.learning_model?.active_version || "");
      const beforeSettled = Number(state.analysis?.learning_model?.settled_unique_matches || 0);
      const updated = await learning.applyToAnalysis(state.analysis, WORKER_URL);
      state.analysis = updated;
      learning.updateRenderedLearningCells(updated);

      const afterVersion = String(updated?.learning_model?.active_version || "");
      const afterSettled = Number(updated?.learning_model?.settled_unique_matches || 0);
      elements.body.dataset.learningVersion = afterVersion;
      elements.body.dataset.learningSettled = String(afterSettled);
      elements.body.dataset.learningCheckedAt = new Date().toISOString();

      if (force || beforeVersion !== afterVersion || beforeSettled !== afterSettled) {
        console.info(
          `Learning自動同步完成：${beforeSettled}→${afterSettled}場，模型 ${beforeVersion || "—"}→${afterVersion || "—"}`
        );
      }
    } catch (error) {
      console.info("Learning自動同步暫時失敗，下輪會重試。", error);
    } finally {
      state.learningRefreshRunning = false;
    }
  }

  function startLearningRefreshClock() {
    if (state.learningRefreshTimer !== null) return;
    state.learningRefreshTimer = window.setInterval(
      () => refreshLearningDisplay().catch(() => null),
      LEARNING_LIVE_REFRESH_MS
    );
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshLearningDisplay().catch(() => null);
    });
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
      elements.statusText.textContent =
        "R2資料已載入｜正在套用最新 Learning 模型，不需重新分析……";
      const analysisWithLearning = await learning.applyToAnalysis(analysis, WORKER_URL);
      state.analysis = analysisWithLearning;
      state.today = today;
      state.sourceBundle = sourceBundle;
      state.config = config;
      state.externalRisk = externalRisk;
      startRiskCountdownClock();
      renderAnalysis(analysisWithLearning, today);
      elements.body.dataset.learningVersion = String(analysisWithLearning?.learning_model?.active_version || "");
      elements.body.dataset.learningSettled = String(analysisWithLearning?.learning_model?.settled_unique_matches || 0);
      elements.body.dataset.learningCheckedAt = new Date().toISOString();
      // 開啟網頁只呈現 R2 既有結果。
      // 不自動搜尋外部消息；由三個按鈕明確啟動 Gemini Google Search 風險掃描。
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
          `Phase 4系統已就緒｜ratio_analysis ` +
          `${analysisWithLearning.matches?.length || 0}場｜` +
          `source_bundle ${
            sourceBundle.matches.length
          }場｜場地 ${
            health.surface_resolved || 0
          }場｜雙方球員識別 ${
            health.both_players_found || 0
          }場｜可按「分析風險」只讀 R2 執行外部覆核` +
          warning;
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
        const mode =
          String(button.dataset.mode || "");

        let fullAnalysisToken = "";
        if (mode === "full") {
          const authorization =
            await requestFullAnalysisAuthorization();
          if (!authorization?.token) return;
          fullAnalysisToken = authorization.token;
          state.fullAnalysisAccessToken = authorization.token;
          state.fullAnalysisAccessExpiresAt = authorization.expiresAt || "";
        }

        await prepareCompletionNotification(
          mode
        );

        if (mode === "full") {
          await runFullPipelinePhase4(fullAnalysisToken);
        } else if (mode === "reanalyze") {
          await rerunCurrentListPhase4();
        } else if (mode === "risk") {
          await runRiskOnlyFromR2();
        } else {
          throw new Error(
            `未知的執行模式：${mode}`
          );
        }
      } catch (error) {
        // 最外層保險：任何未預期錯誤都必須顯示在畫面，
        // 不再讓按鈕看起來像「完全沒反應」。
        console.error(error);
        elements.statusLine.classList.add("error");
        elements.statusText.textContent =
          `按鈕執行失敗：${error?.message || String(error)}`;
        await notifyPipelineFailure(error);
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
    const entry = riskEntryMap().get(aiClient.externalRiskMatchKey(row));
    if (entry) openRiskDialog(entry);
  });

  elements.fullAnalysisPasswordToggle?.addEventListener("click", () => {
    const input = elements.fullAnalysisPassword;
    if (!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    elements.fullAnalysisPasswordToggle.setAttribute(
      "aria-pressed",
      showing ? "false" : "true"
    );
    input.focus();
  });

  elements.fullAnalysisAuthCancel?.addEventListener(
    "click",
    () => closeFullAnalysisAuth(null)
  );
  elements.fullAnalysisAuthClose?.addEventListener(
    "click",
    () => closeFullAnalysisAuth(null)
  );
  elements.fullAnalysisAuthDialog?.addEventListener("click", event => {
    if (event.target === elements.fullAnalysisAuthDialog) {
      closeFullAnalysisAuth(null);
    }
  });
  elements.fullAnalysisAuthDialog?.addEventListener("cancel", event => {
    event.preventDefault();
    closeFullAnalysisAuth(null);
  });
  elements.fullAnalysisAuthDialog?.addEventListener("close", () => {
    const result = state.fullAnalysisAuthVerified
      ? {
          token: state.fullAnalysisAccessToken,
          expiresAt: state.fullAnalysisAccessExpiresAt
        }
      : null;
    state.fullAnalysisAuthVerified = false;
    finishFullAnalysisAuth(result);
  });
  elements.fullAnalysisAuthForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const password = String(
      elements.fullAnalysisPassword?.value || ""
    );
    if (!password) {
      setFullAnalysisAuthStatus("請輸入啟動密碼。", "error");
      elements.fullAnalysisPassword?.focus();
      return;
    }
    elements.fullAnalysisAuthSubmit.disabled = true;
    elements.fullAnalysisAuthCancel.disabled = true;
    elements.fullAnalysisAuthClose.disabled = true;
    setFullAnalysisAuthStatus(
      "正在由 Cloudflare Worker 驗證啟動密碼……",
      "checking"
    );
    try {
      const authorization =
        await verifyFullAnalysisPassword(password);
      state.fullAnalysisAccessToken = authorization.token;
      state.fullAnalysisAccessExpiresAt = authorization.expiresAt || "";
      setFullAnalysisAuthStatus(
        "驗證成功，正在啟動完整分析……",
        "success"
      );
      setTimeout(() => {
        closeFullAnalysisAuth({
          token: authorization.token,
          expiresAt: authorization.expiresAt || ""
        });
      }, 220);
    } catch (error) {
      const status = Number(error?.status || 0);
      const retry = Number(error?.retryAfterSeconds || 0);
      let message = error?.message || "啟動密碼驗證失敗。";
      if (status === 401) {
        message = "啟動密碼不正確，完整分析尚未執行。";
      } else if (status === 429) {
        message = retry > 0
          ? `密碼嘗試次數過多，請 ${retry} 秒後再試。`
          : "密碼嘗試次數過多，請稍後再試。";
      } else if (status === 503) {
        message = "Cloudflare 尚未設定 FULL_ANALYSIS_PASSWORD Secret。";
      } else if (!status) {
        message = "無法連線 Cloudflare Worker，完整分析尚未執行。";
      }
      setFullAnalysisAuthStatus(message, "error");
      elements.fullAnalysisPassword?.select();
    } finally {
      elements.fullAnalysisAuthSubmit.disabled = false;
      elements.fullAnalysisAuthCancel.disabled = false;
      elements.fullAnalysisAuthClose.disabled = false;
    }
  });

  document.getElementById("risk-dialog-close").addEventListener("click", () => elements.riskDialog.close());
  elements.riskDialog.addEventListener("click", event => {
    if (event.target === elements.riskDialog) elements.riskDialog.close();
  });

  function setGeminiUsagePopover(open) {
    if (!elements.geminiUsagePopover || !elements.geminiUsageHelp) return;
    const shouldOpen = Boolean(open);
    elements.geminiUsagePopover.hidden = !shouldOpen;
    elements.geminiUsageHelp.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  }

  elements.geminiUsageHelp?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    setGeminiUsagePopover(elements.geminiUsagePopover?.hidden);
  });

  document.addEventListener("click", event => {
    if (!elements.geminiUsage?.contains(event.target)) setGeminiUsagePopover(false);
  });

  [elements.riskStatus, elements.riskCacheStatus].forEach(node => {
    node?.addEventListener("click", () => {
      if (state.lastRiskDiagnostic) openRiskDialog(state.lastRiskDiagnostic);
    });
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
  document.getElementById("chat-settings").addEventListener("click", openAiSettings);
  document.getElementById("settings-close").addEventListener("click", () => elements.settingsDialog.close());
  document.getElementById("settings-cancel").addEventListener("click", () => elements.settingsDialog.close());
  document.getElementById("ai-settings-form").addEventListener("submit", event => {
    event.preventDefault();
    aiSettings = {
      model: aiClient.CHAT_MODEL,
      systemPrompt:
        document.getElementById("ai-system-prompt").value.trim() ||
        DEFAULT_TENNIS_PROMPT
    };
    persistAiSettings();
    document.getElementById("settings-status").textContent = "設定已儲存｜共用 Worker Secret";
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
    const chatUsageOperationId = beginGeminiUsageOperation(
      "chat",
      `chat-${Date.now()}`,
      "處理中"
    );
    const pending = createChatMessage(
      "model pending",
      "Gemini 2.5 Flash 正在回答；透過 Cloudflare Worker 共用 Secret，需要近期資料時會使用 Google Search…"
    );

    try {

      const workerToken = configurationValue(
        WORKER_UPLOAD_TOKEN,
        "WORKER_UPLOAD_TOKEN"
      );

      const analysisRows = Array.isArray(state.analysis?.matches)
        ? state.analysis.matches
        : [];
      if (state.riskScanning) {
        pending.body.textContent =
          "風險掃描進行中；本次問答已排入共用佇列，將在整批風險掃描完成後執行。";
        updateGeminiUsageOperationNote(
          chatUsageOperationId,
          "等待風險掃描完成"
        );
        while (state.riskScanning) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      const result = await aiClient.ask(question, {
        payload: state.today,
        analysis: state.analysis,
        rows: analysisRows,
        revision: Number(elements.body.dataset.revision || 0),
        history: requestHistory,
        workerUrl: WORKER_URL,
        workerToken,
        externalRisk: state.externalRisk,
        customSystemPrompt: aiSettings.systemPrompt,
        onQueueState: info => {
          if (info.state === "queued") {
            updateGeminiUsageOperationNote(
              chatUsageOperationId,
              `Gemini 佇列等待中｜前方 ${info.position || 1} 個請求`
            );
          } else if (info.state === "running") {
            updateGeminiUsageOperationNote(chatUsageOperationId, "Gemini 佇列執行中");
          }
        }
      });

      pending.message.classList.remove("pending");

      if (result.model) {
        document.getElementById(
          "chat-model-label"
        ).textContent =
          `${result.model || aiClient.CHAT_MODEL}｜Google Search`;
      }

      const answer = String(result.answer || "");
      await typeAnswer(pending, answer);
      addContextMeta(pending.message, result);
      addSources(
        pending.message,
        result.grounding_sources || [],
        result.web_search_queries || []
      );
      if (usageNumber(result.usage, "totalTokenCount") > 0) {
        recordGeminiUsage(result.usage, {
          grounded: Boolean(result.grounding_requested),
          kind: "chat",
          operationId: chatUsageOperationId
        });
        updateGeminiUsageOperationNote(chatUsageOperationId, "完成");
      } else {
        updateGeminiUsageOperationNote(
          chatUsageOperationId,
          result.model === "JavaScript" ? "JavaScript 直接回答｜0 API" : "未回傳 Token 用量"
        );
      }
      state.chatHistory.push({ role: "model", text: answer });
    } catch (error) {
      updateGeminiUsageOperationNote(chatUsageOperationId, "請求失敗｜未計入成功用量");
      pending.message.remove();
      appendError(`AI助理錯誤：${error?.message || String(error)}`);
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

  persistAiSettings();
  renderGeminiUsage();
  window.setInterval(() => renderGeminiUsage(), 15000);
  window.addEventListener("resize", hideCard);
  window.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      hideCard();
      setGeminiUsagePopover(false);
    }
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

  startLearningRefreshClock();
  loadData();
})();
