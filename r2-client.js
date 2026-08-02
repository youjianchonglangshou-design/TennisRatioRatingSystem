(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TennisRatioR2Client = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  async function responseDetail(response, fallback) {
    const text = await response.text();
    try {
      const payload = JSON.parse(text);
      return payload.error || payload.detail || payload.message || payload.title || fallback;
    } catch {
      return text || fallback;
    }
  }

  async function fetchJson(workerUrl, filename) {
    const base = normalizeBaseUrl(workerUrl);
    if (!base) throw new Error("WORKER_URL 尚未設定。");
    const response = await fetch(`${base}/${filename}?v=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      const detail = await responseDetail(response, `${filename} 讀取失敗`);
      throw new Error(`${filename} HTTP ${response.status}：${detail}`);
    }
    return response.json();
  }

  async function uploadOddsBundle(workerUrl, uploadToken, bundle) {
    const base = normalizeBaseUrl(workerUrl);
    const token = String(uploadToken || "").trim();
    if (!base) throw new Error("WORKER_URL 尚未設定。");
    if (!token) throw new Error("WORKER_UPLOAD_TOKEN 尚未填入。");

    const response = await fetch(`${base}/upload`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        matchups: bundle.matchups,
        markets: bundle.markets,
        today_matches: bundle.todayMatches
      }),
      cache: "no-store"
    });

    if (!response.ok) {
      const detail = await responseDetail(response, "Worker 上傳失敗");
      throw new Error(`Worker HTTP ${response.status}：${detail}`);
    }
    return response.json();
  }

  async function uploadSourceBundle(workerUrl, uploadToken, sourceBundle) {
    const base = normalizeBaseUrl(workerUrl);
    const token = String(uploadToken || "").trim();
    if (!base) throw new Error("WORKER_URL 尚未設定。");
    if (!token) throw new Error("WORKER_UPLOAD_TOKEN 尚未填入。");
    if (!sourceBundle || !Array.isArray(sourceBundle.matches)) {
      throw new Error("source_bundle 必須是含 matches 陣列的 JSON 物件。");
    }

    const response = await fetch(`${base}/upload-source`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ source_bundle: sourceBundle }),
      cache: "no-store"
    });
    if (!response.ok) {
      const detail = await responseDetail(response, "Worker來源資料上傳失敗");
      throw new Error(`Worker HTTP ${response.status}：${detail}`);
    }
    return response.json();
  }

  return {
    normalizeBaseUrl,
    fetchJson,
    uploadOddsBundle,
    uploadSourceBundle
  };
});
