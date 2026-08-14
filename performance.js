(() => {
  "use strict";
  const WORKER_URL = "https://tennis-json-store.youjianchonglangshou.workers.dev";
  const state = { days: "7", payload: null, matches: [] };
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function pct(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(2)}%` : "—";
  }
  function signedPct(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number >= 0 ? "+" : ""}${number.toFixed(2)}%` : "—";
  }
  function gradeSummary(payload, grade) {
    return payload?.summary?.grades?.[grade] || { wins:0, losses:0, total:0, special:0, win_rate:null, rejection_success_rate:null };
  }
  function recordHtml(summary, grade) {
    if (!summary?.total) return '<span class="record empty">尚無正式結果</span>';
    const extra = grade === "淘汰"
      ? `淘汰成功 ${pct(summary.rejection_success_rate)}`
      : `勝率 ${pct(summary.win_rate)}`;
    return `<div class="record"><strong>${summary.wins}勝 ${summary.losses}敗</strong><small>${extra}</small></div>`;
  }
  function updateSummary(payload) {
    const totalWins = ["A","B","C","淘汰","未評級"].reduce((sum,g)=>sum+(payload?.summary?.grades?.[g]?.wins||0),0);
    const totalLosses = ["A","B","C","淘汰","未評級"].reduce((sum,g)=>sum+(payload?.summary?.grades?.[g]?.losses||0),0);
    const total = totalWins + totalLosses;
    $("overall-record").textContent = total ? `${totalWins}勝 ${totalLosses}敗` : "尚無正式結果";
    $("overall-sub").textContent = total
      ? `熱門方總勝率 ${((totalWins / total) * 100).toFixed(2)}%｜特殊 ${payload?.summary?.special || 0} 場`
      : `特殊 ${payload?.summary?.special || 0} 場`;
    document.querySelectorAll("[data-grade-card]").forEach(card => {
      const grade = card.dataset.gradeCard;
      const summary = gradeSummary(payload, grade);
      const main = card.querySelector(".summary-main");
      const sub = card.querySelector(".summary-sub");
      main.textContent = summary.total ? `${summary.wins}勝 ${summary.losses}敗` : "—";
      if (grade === "淘汰") {
        sub.textContent = summary.total
          ? `熱門方勝率 ${pct(summary.win_rate)}｜淘汰成功率 ${pct(summary.rejection_success_rate)}${summary.special ? `｜特殊 ${summary.special}` : ""}`
          : `特殊 ${summary.special || 0} 場`;
      } else {
        sub.textContent = summary.total
          ? `熱門方勝率 ${pct(summary.win_rate)}${summary.special ? `｜特殊 ${summary.special}` : ""}`
          : `特殊 ${summary.special || 0} 場`;
      }
    });
  }
  function renderDaily(payload) {
    const body = $("daily-body");
    const days = Array.isArray(payload?.days) ? payload.days : [];
    if (!days.length) {
      body.innerHTML = '<tr><td colspan="7" class="loading-cell">R2 尚無正式結算資料。</td></tr>';
      return;
    }
    body.innerHTML = days.map(day => {
      const s = day.summary || {};
      const wins = ["A","B","C","淘汰","未評級"].reduce((sum,g)=>sum+(s?.grades?.[g]?.wins||0),0);
      const losses = ["A","B","C","淘汰","未評級"].reduce((sum,g)=>sum+(s?.grades?.[g]?.losses||0),0);
      const total = wins + losses;
      const allHtml = total ? `<div class="record"><strong>${wins}勝 ${losses}敗</strong><small>${pct((wins/total)*100)}</small></div>` : '<span class="record empty">—</span>';
      return `<tr>
        <td><strong>${escapeHtml(day.date)}</strong></td>
        <td>${allHtml}</td>
        <td>${recordHtml(s?.grades?.A,"A")}</td>
        <td>${recordHtml(s?.grades?.B,"B")}</td>
        <td>${recordHtml(s?.grades?.C,"C")}</td>
        <td>${recordHtml(s?.grades?.淘汰,"淘汰")}</td>
        <td>${Number(s?.special || 0)}</td>
      </tr>`;
    }).join("");
  }
  function resultLabel(row) {
    if (row?.training_eligible !== true || typeof row?.hot_won !== "boolean") return "特殊";
    return row.hot_won ? "勝" : "敗";
  }
  function filteredMatches() {
    const grade = $("grade-filter").value;
    const result = $("result-filter").value;
    const q = $("search-input").value.trim().toLowerCase();
    return state.matches.filter(row => {
      if (grade !== "全部" && row.rating !== grade) return false;
      if (result !== "全部" && resultLabel(row) !== result) return false;
      if (q) {
        const hay = [row.home,row.away,row.hot_player,row.league,row.date_time_taipei].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }
  function renderDetails() {
    const body = $("detail-body");
    const rows = filteredMatches();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="loading-cell">目前篩選條件沒有結算場次。</td></tr>';
      $("detail-footer").textContent = "顯示 0 場";
      return;
    }
    body.innerHTML = rows.map(row => {
      const label = resultLabel(row);
      const resultClass = label === "勝" ? "win" : label === "敗" ? "loss" : "special";
      const score = Number.isFinite(Number(row.home_score)) && Number.isFinite(Number(row.away_score))
        ? `${Number(row.home_score)} : ${Number(row.away_score)}` : "—";
      const match = `${escapeHtml(row.home || "—")} <span class="muted">vs</span> ${escapeHtml(row.away || "—")}`;
      const reason = label === "特殊" && row.reason ? `<span class="special-reason">${escapeHtml(row.reason)}</span>` : "";
      return `<tr>
        <td>${escapeHtml(row.date_time_taipei || row.date || "—")}</td>
        <td><span class="grade-pill ${escapeHtml(row.rating || "未評級")}">${escapeHtml(row.rating || "未評級")}</span></td>
        <td>${match}</td>
        <td class="hot-player">${escapeHtml(row.hot_player || "—")}</td>
        <td class="metric">${pct(row.rating_probability)}</td>
        <td class="metric">${signedPct(row.rating_ev)}</td>
        <td class="score">${score}</td>
        <td><span class="result-pill ${resultClass}">${label === "特殊" ? "特殊" : `熱門方${label}`}</span>${reason}</td>
      </tr>`;
    }).join("");
    $("detail-footer").textContent = `顯示 ${rows.length}／${state.matches.length} 場`;
  }
  async function loadPerformance(days = state.days) {
    state.days = days;
    $("status-text").textContent = `正在讀取近 ${days} 日 R2 正式結算資料……`;
    $("refresh-button").disabled = true;
    try {
      const response = await fetch(`${WORKER_URL}/performance/results?days=${encodeURIComponent(days)}&v=${Date.now()}`, { cache:"no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
      state.payload = payload;
      state.matches = Array.isArray(payload.matches) ? payload.matches : [];
      updateSummary(payload);
      renderDaily(payload);
      renderDetails();
      const range = payload.date_from && payload.date_to ? `${payload.date_from} ～ ${payload.date_to}` : "尚無日期";
      $("status-text").textContent = `${range}｜正式 ${payload?.summary?.completed || 0} 場｜特殊 ${payload?.summary?.special || 0} 場｜資料由 R2 settlement/results 整合`;
    } catch (error) {
      $("status-text").textContent = `戰績讀取失敗：${error?.message || error}`;
      $("daily-body").innerHTML = `<tr><td colspan="7" class="loading-cell">${escapeHtml(error?.message || String(error))}</td></tr>`;
      $("detail-body").innerHTML = '<tr><td colspan="8" class="loading-cell">請確認 Cloudflare Worker 已部署新版 /performance/results。</td></tr>';
    } finally {
      $("refresh-button").disabled = false;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".range-tab").forEach(button => button.addEventListener("click", () => {
      document.querySelectorAll(".range-tab").forEach(item => item.classList.toggle("active", item === button));
      loadPerformance(button.dataset.days || "7");
    }));
    $("refresh-button").addEventListener("click", () => loadPerformance(state.days));
    ["grade-filter","result-filter","search-input"].forEach(id => $(id).addEventListener(id === "search-input" ? "input" : "change", renderDetails));
    loadPerformance("7");
  });
})();
