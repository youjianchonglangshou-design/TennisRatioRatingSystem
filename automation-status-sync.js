(() => {
  "use strict";

  const WORKER_URL = "https://tennis-json-store.youjianchonglangshou.workers.dev";
  const POLL_MS = 5000;

  const state = {
    busy: false,
    payload: null,
    timer: null,
    reloading: false,
  };

  const statusLine = document.getElementById("job-status");
  const statusText = document.getElementById("status-text");
  const chatToggle = document.getElementById("chat-toggle");

  function isBusy(payload) {
    return Boolean(
      payload?.busy ||
      ["QUEUED", "RUNNING"].includes(
        String(payload?.status || "").toUpperCase()
      )
    );
  }

  function displayMessage(payload) {
    const message = String(payload?.message || "").trim();
    if (message) return message;

    const status = String(payload?.status || "").toUpperCase();
    if (status === "QUEUED") {
      return "自動排程已啟動｜等待 GitHub 開啟網球頁面執行完整分析";
    }
    if (status === "RUNNING") {
      return "自動排程完整分析進行中｜GitHub 正在執行原本 app.js";
    }
    return "自動排程完整分析進行中";
  }

  function setUiLocked(locked) {
    document.querySelectorAll(".run-button").forEach(button => {
      button.disabled = locked;
    });
    if (chatToggle) {
      chatToggle.disabled = locked;
      chatToggle.title = locked
        ? "自動排程完整分析進行中，AI助理暫不可用"
        : "Gemini 網路問答已就緒";
    }
  }

  function showRunning(payload) {
    setUiLocked(true);
    document.body.dataset.automationBusy = "1";
    statusLine?.classList.remove("error");
    statusLine?.classList.add("running");
    if (statusText) statusText.textContent = displayMessage(payload);
  }

  async function reloadLatestData() {
    if (state.reloading) return;
    state.reloading = true;
    try {
      const reload = window.TennisRatioApp?.reloadData;
      if (typeof reload === "function") {
        await reload();
      } else {
        window.location.reload();
      }
    } finally {
      state.reloading = false;
    }
  }

  async function applyStatus(payload) {
    const wasBusy = state.busy;
    state.payload = payload || null;
    state.busy = isBusy(payload);
    document.body.dataset.automationBusy = state.busy ? "1" : "0";

    if (state.busy) {
      showRunning(payload);
      return;
    }

    if (!wasBusy) return;

    const status = String(payload?.status || "").toUpperCase();
    if (status === "FAILED" || status === "STALE") {
      setUiLocked(false);
      statusLine?.classList.remove("running");
      statusLine?.classList.add("error");
      if (statusText) {
        statusText.textContent = String(
          payload?.message ||
          (status === "STALE"
            ? "自動排程完整分析狀態逾時，請查看 GitHub Actions。"
            : "自動排程完整分析失敗，請查看 GitHub Actions。")
        );
      }
      return;
    }

    await reloadLatestData();
  }

  async function poll() {
    if (state.timer !== null) window.clearTimeout(state.timer);
    try {
      const response = await fetch(
        `${WORKER_URL}/api/automation/status?t=${Date.now()}`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error(`automation status HTTP ${response.status}`);
      }
      await applyStatus(await response.json());
    } catch (error) {
      console.info("自動排程狀態暫時無法讀取，下輪會重試。", error);
    } finally {
      state.timer = window.setTimeout(
        () => poll().catch(() => null),
        POLL_MS
      );
    }
  }

  window.TennisRatioAutomationSync = {
    getStatus: () => state.payload,
    isBusy: () => state.busy,
    pollNow: poll,
  };

  poll();
})();
