(() => {
  "use strict";

  const renderer = window.TennisRatioRenderer;
  if (!renderer) {
    throw new Error("renderer.js 尚未載入。");
  }

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
    generating: false
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
    settingsDialog: document.getElementById("gemini-settings-dialog")
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
    try {
      return Object.assign({
        apiKey: "",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.5-flash",
        systemPrompt: DEFAULT_TENNIS_PROMPT
      }, JSON.parse(localStorage.getItem(CHAT_SETTINGS_KEY) || "{}"));
    } catch (error) {
      return {
        apiKey: "",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.5-flash",
        systemPrompt: DEFAULT_TENNIS_PROMPT
      };
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

  async function loadData() {
    setRunning(true);
    elements.statusText.textContent = "正在以 JavaScript 讀取 ratio_analysis.json 與 today_matches.json……";
    try {
      const [analysis, today] = await Promise.all([
        fetchJson("ratio_analysis.json"),
        fetchJson("today_matches.json")
      ]);
      state.analysis = analysis;
      state.today = today;
      renderAnalysis(analysis, today);
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

  document.querySelectorAll(".run-button").forEach(button => {
    button.addEventListener("click", () => {
      elements.statusLine.classList.remove("running", "error");
      const mode = button.dataset.mode === "full" ? "重新抓取＋完整分析" : "只重跑目前清單";
      elements.statusText.textContent = `${mode}：第 2 階段已完成動態 UI；分析管線將在後續階段接入。`;
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
      apiKey: document.getElementById("gemini-api-key").value.trim(),
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
    state.chatHistory.push({ role: "user", text: question });
    createChatMessage("user", question);
    elements.chatInput.value = "";
    appendError("Gemini介面與設定已完整保留；第 2 階段尚未接入瀏覽器端 Gemini API。");
    elements.chatInput.focus();
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
    getTodayMatches: () => state.today
  };

  loadData();
})();
