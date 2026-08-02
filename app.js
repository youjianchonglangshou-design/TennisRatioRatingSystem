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
  // 快速測試階段：請自行填入三組值。
  // ============================================================
  const ARCADIA_API_KEY =
    "請把你的 Arcadia API Key 貼在這裡";

  const WORKER_URL =
    "https://tennis-json-store.youjianchonglangshou.workers.dev";

  const WORKER_UPLOAD_TOKEN =
    "請把你的 UPLOAD_TOKEN 貼在這裡";

  // Google AI Studio Gemini API Key。
  const GEMINI_API_KEY =
    "請把你的 Gemini API Key 貼在這裡";

  const DATA_BASE_URL = ".";
  const CHAT_SETTINGS_KEY = "tennisratio.gemini.settings.v1";
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
    config: null
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
    downloadRatio: document.getElementById("download-ratio")
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

  function configuredGeminiApiKey() {
    const key = String(GEMINI_API_KEY || "").trim();
    if (!key || key.includes("請把你的")) return "";
    return key;
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
    const filename = isPinnacle
      ? "today_matches.json"
      : "ratio_analysis.json";

    try {
      const data = isPinnacle
        ? (state.today || await fetchLatestTodayMatches())
        : (state.analysis || await fetchLatestAnalysis());

      if (isPinnacle) {
        updateTodayState(data);
      } else {
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
      elements.statusText.textContent = `完整分析執行失敗：${error.message}`;
    } finally {
      setRunning(false);
    }
  }

  async function rerunCurrentListPhase4() {
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
      elements.statusText.textContent = `目前清單完整分析失敗：${error.message}`;
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
    const rows = Array.isArray(analysis?.matches) ? analysis.matches : [];
    const rendered = renderer.renderRows(rows);

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
      const desired = Number(elements.card.dataset.desiredWidth || 1080);
      const width = Math.min(desired, window.innerWidth - 16);
      elements.card.style.width = `${width}px`;
      elements.card.style.maxWidth = "none";
      let left = rect.left - width - gap;
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      elements.card.style.left = `${Math.max(8, left)}px`;
      const height = elements.card.offsetHeight;
      let top = rect.bottom + gap;
      if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - gap);
      elements.card.style.top = `${top}px`;
      return;
    }
    const width = elements.card.offsetWidth;
    const height = elements.card.offsetHeight;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left));
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - gap);
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
      apiKey: "",
      baseUrl:
        "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-flash",
      systemPrompt: DEFAULT_TENNIS_PROMPT
    };

    try {
      const saved = JSON.parse(
        localStorage.getItem(CHAT_SETTINGS_KEY) || "{}"
      );
      const settings = Object.assign({}, defaults, saved);
      const appJsKey = configuredGeminiApiKey();

      // app.js 的 GEMINI_API_KEY 優先於 localStorage。
      if (appJsKey) settings.apiKey = appJsKey;

      return settings;
    } catch (error) {
      const settings = Object.assign({}, defaults);
      const appJsKey = configuredGeminiApiKey();
      if (appJsKey) settings.apiKey = appJsKey;
      return settings;
    }
  }

  let geminiSettings = loadGeminiSettings();

  function persistGeminiSettings() {
    localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify(geminiSettings));
    document.getElementById("chat-model-label").textContent = geminiSettings.model || "gemini-2.5-flash";
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
      if (!geminiSettings.apiKey) setTimeout(openGeminiSettings, 260);
    }
  }

  function openGeminiSettings() {
    document.getElementById("gemini-api-key").value = geminiSettings.apiKey || "";
    document.getElementById("gemini-base-url").value = geminiSettings.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
    document.getElementById("gemini-model").value = geminiSettings.model || "gemini-2.5-flash";
    document.getElementById("gemini-system-prompt").value = geminiSettings.systemPrompt || DEFAULT_TENNIS_PROMPT;
    document.getElementById("gemini-api-key").type = "password";
    document.getElementById("toggle-api-key").textContent = "顯示";
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
      const [analysis, today, sourceBundle, config] = await Promise.all([
        fetchLatestAnalysis(),
        fetchLatestTodayMatches(),
        r2Client.fetchJson(WORKER_URL, "source_bundle.json").catch(() => null),
        fetchJson("ratio_config.json")
      ]);
      state.analysis = analysis;
      state.today = today;
      state.sourceBundle = sourceBundle;
      state.config = config;
      renderAnalysis(analysis, today);
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

  document.querySelectorAll(".run-button").forEach(button => {
    button.addEventListener("click", async () => {
      try {
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
  document.getElementById("toggle-api-key").addEventListener("click", () => {
    const input = document.getElementById("gemini-api-key");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    document.getElementById("toggle-api-key").textContent = show ? "隱藏" : "顯示";
  });
  document.getElementById("gemini-settings-form").addEventListener("submit", event => {
    event.preventDefault();
    geminiSettings = {
      apiKey:
        configuredGeminiApiKey() ||
        document.getElementById("gemini-api-key").value.trim(),
      baseUrl: document.getElementById("gemini-base-url").value.trim().replace(/\/+$/, "") || "https://generativelanguage.googleapis.com/v1beta",
      model: document.getElementById("gemini-model").value.trim() || "gemini-2.5-flash",
      systemPrompt: document.getElementById("gemini-system-prompt").value.trim() || DEFAULT_TENNIS_PROMPT
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
      if (!geminiSettings.apiKey) {
        openGeminiSettings();
        throw new Error("請先在模型設定貼上 Gemini API Key。");
      }
      const analysisRows = Array.isArray(state.analysis?.matches)
        ? state.analysis.matches
        : [];
      const result = await geminiClient.ask(question, {
        payload: state.today,
        analysis: state.analysis,
        rows: analysisRows,
        revision: Number(elements.body.dataset.revision || 0),
        history: requestHistory,
        apiKey: geminiSettings.apiKey,
        model: geminiSettings.model,
        baseUrl: geminiSettings.baseUrl,
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
    getSourceBundle: () => state.sourceBundle
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
