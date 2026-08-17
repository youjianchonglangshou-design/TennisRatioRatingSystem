(() => {
  "use strict";

  const WORKER_URL = "https://tennis-json-store.youjianchonglangshou.workers.dev";
  const state = {
    days: "7",
    payload: null,
    matches: [],
    sortKey: "date_time_taipei",
    sortDir: "desc",
  };

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function pct(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number.toFixed(2)}%` : "—";
  }

  function ratioNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Math.abs(number) > 1.000001 ? number / 100 : number;
  }

  function ratioPct(value, digits = 2, signed = false) {
    const ratio = ratioNumber(value);
    if (ratio === null) return "—";
    const percentage = ratio * 100;
    const prefix = signed && percentage > 0 ? "+" : "";
    return `${prefix}${percentage.toFixed(digits)}%`;
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizedRating(row) {
    const text = String(row?.rating || "").trim();
    return text || "未評級";
  }

  function gradeOrderValue(value) {
    return ({ A: 5, B: 4, C: 3, 淘汰: 2, 未評級: 1 })[normalizedRating({ rating: value })] || 0;
  }

  function gradeSummary(payload, grade) {
    return payload?.summary?.grades?.[grade] || {
      wins: 0, losses: 0, total: 0, special: 0, win_rate: null, rejection_success_rate: null,
    };
  }

  function recordHtml(summary, grade) {
    if (!summary?.total) return '<span class="record empty">尚無正式結果</span>';
    const extra = grade === "淘汰"
      ? `淘汰成功 ${pct(summary.rejection_success_rate)}`
      : `勝率 ${pct(summary.win_rate)}`;
    return `<div class="record"><strong>${summary.wins}勝 ${summary.losses}敗</strong><small>${extra}</small></div>`;
  }

  function updateSummary(payload) {
    const grades = ["A", "B", "C", "淘汰", "未評級"];
    const totalWins = grades.reduce((sum, g) => sum + (payload?.summary?.grades?.[g]?.wins || 0), 0);
    const totalLosses = grades.reduce((sum, g) => sum + (payload?.summary?.grades?.[g]?.losses || 0), 0);
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

  function resultLabel(row) {
    if (row?.training_eligible !== true || typeof row?.hot_won !== "boolean") return "特殊";
    return row.hot_won ? "勝" : "敗";
  }

  function eligibleProbabilityMatches(minRatio) {
    return state.matches.filter(row => {
      const probability = ratioNumber(row?.rating_probability);
      return row?.training_eligible === true &&
        typeof row?.hot_won === "boolean" &&
        probability !== null && probability >= minRatio;
    });
  }

  function thresholdStats(minRatio) {
    const rows = eligibleProbabilityMatches(minRatio);
    const wins = rows.filter(row => row.hot_won === true).length;
    const losses = rows.length - wins;
    return {
      rows,
      wins,
      losses,
      total: rows.length,
      winRate: rows.length ? (wins / rows.length) * 100 : null,
    };
  }

  function renderThresholds() {
    const wrap = $("probability-threshold-cards");
    if (!wrap) return;
    const thresholds = [0.60, 0.65, 0.70];
    wrap.innerHTML = thresholds.map(threshold => {
      const stats = thresholdStats(threshold);
      const highlighted = threshold === 0.65 ? " focus" : "";
      return `<button type="button" class="threshold-card${highlighted}" data-threshold-filter="${threshold.toFixed(2)}" title="套用到下方逐場結算">
        <span class="threshold-label">評級勝率 ≥ ${(threshold * 100).toFixed(0)}%</span>
        <strong>${stats.total ? `${stats.wins}勝 ${stats.losses}敗` : "尚無樣本"}</strong>
        <small>${stats.total ? `實際勝率 ${stats.winRate.toFixed(2)}%｜樣本 ${stats.total} 場` : "正式結算 0 場"}</small>
      </button>`;
    }).join("");

    const focus = thresholdStats(0.65);
    const gradeOrder = ["A", "B", "C", "淘汰", "未評級"];
    const gradeParts = gradeOrder.map(grade => {
      const rows = focus.rows.filter(row => normalizedRating(row) === grade);
      if (!rows.length) return null;
      const wins = rows.filter(row => row.hot_won === true).length;
      const rate = (wins / rows.length) * 100;
      return `<span><b>${escapeHtml(grade)}</b> ${wins}勝${rows.length - wins}敗／${rate.toFixed(1)}%</span>`;
    }).filter(Boolean);

    $("threshold-65-breakdown").innerHTML = focus.total
      ? `<b>≥65% 不分評級：</b>${focus.wins}勝 ${focus.losses}敗，實際勝率 <em>${focus.winRate.toFixed(2)}%</em>。${gradeParts.length ? `<span class="threshold-grade-breakdown">${gradeParts.join("｜")}</span>` : ""}`
      : `<b>≥65% 不分評級：</b>目前尚無可計算的正式結算樣本。`;

    wrap.querySelectorAll("[data-threshold-filter]").forEach(button => {
      button.addEventListener("click", () => {
        $("probability-filter").value = button.dataset.thresholdFilter || "全部";
        renderDetails();
        $("detail-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }


  function aiSnapshot(row) {
    const snapshot = row?.ai_prediction_snapshot;
    if (!snapshot || typeof snapshot !== "object") return null;
    const probability = ratioNumber(snapshot.probability);
    const decision = String(snapshot.decision || "").trim();
    if (probability === null || !["支持", "保留", "警示"].includes(decision)) return null;
    return {
      ...snapshot,
      probability,
      decision,
    };
  }

  function aiEligibleRows() {
    return state.matches.filter(row =>
      row?.training_eligible === true &&
      typeof row?.hot_won === "boolean" &&
      aiSnapshot(row)
    );
  }

  function aiProbabilityStats(minRatio) {
    const rows = aiEligibleRows().filter(row => aiSnapshot(row).probability >= minRatio);
    const wins = rows.filter(row => row.hot_won === true).length;
    const losses = rows.length - wins;
    return {
      rows,
      wins,
      losses,
      total: rows.length,
      winRate: rows.length ? (wins / rows.length) * 100 : null,
    };
  }

  function aiDecisionStats(decision) {
    const rows = aiEligibleRows().filter(row => aiSnapshot(row).decision === decision);
    let hits = 0;
    let misses = 0;
    for (const row of rows) {
      if (decision === "保留") continue;
      const hit = decision === "支持" ? row.hot_won === true : row.hot_won === false;
      if (hit) hits += 1;
      else misses += 1;
    }
    return {
      rows,
      hits,
      misses,
      total: rows.length,
      accuracy: hits + misses ? (hits / (hits + misses)) * 100 : null,
      hotWinRate: rows.length ? (rows.filter(row => row.hot_won === true).length / rows.length) * 100 : null,
    };
  }

  function aiDecisionResult(row) {
    const snapshot = aiSnapshot(row);
    if (!snapshot || row?.training_eligible !== true || typeof row?.hot_won !== "boolean") {
      return { label: "尚無結果", className: "pending" };
    }
    if (snapshot.decision === "保留") {
      return {
        label: row.hot_won ? "保留｜熱門方勝" : "保留｜熱門方敗",
        className: "hold",
      };
    }
    const hit = snapshot.decision === "支持" ? row.hot_won === true : row.hot_won === false;
    return {
      label: hit ? "AI命中" : "AI失誤",
      className: hit ? "hit" : "miss",
    };
  }

  function renderAiValidation() {
    const eligible = aiEligibleRows();
    const support = aiDecisionStats("支持");
    const warning = aiDecisionStats("警示");
    const at80 = aiProbabilityStats(0.80);

    $("ai-snapshot-count").textContent = `${eligible.length} 場`;
    $("ai-snapshot-sub").textContent = eligible.length
      ? "只計入開賽前已保存且有正式賽果"
      : "新 AI 快照會從部署後開始累積";

    $("ai-support-record").textContent = support.rows.length
      ? `${support.hits}中 ${support.misses}錯`
      : "尚無樣本";
    $("ai-support-sub").textContent = support.accuracy !== null
      ? `支持命中率 ${support.accuracy.toFixed(2)}%｜樣本 ${support.rows.length}`
      : "等待 AI 支持場次結算";

    $("ai-warning-record").textContent = warning.rows.length
      ? `${warning.hits}中 ${warning.misses}錯`
      : "尚無樣本";
    $("ai-warning-sub").textContent = warning.accuracy !== null
      ? `警示命中率 ${warning.accuracy.toFixed(2)}%｜樣本 ${warning.rows.length}`
      : "等待 AI 警示場次結算";

    $("ai-80-record").textContent = at80.total
      ? `${at80.wins}勝 ${at80.losses}敗`
      : "尚無樣本";
    $("ai-80-sub").textContent = at80.winRate !== null
      ? `熱門方實際勝率 ${at80.winRate.toFixed(2)}%｜樣本 ${at80.total}`
      : "等待 AI ≥80% 場次結算";

    const thresholds = [0.60, 0.70, 0.80];
    $("ai-threshold-cards").innerHTML = thresholds.map(threshold => {
      const stats = aiProbabilityStats(threshold);
      const focus = threshold === 0.80 ? " focus" : "";
      return `<article class="ai-threshold-card${focus}">
        <span>AI 勝率 ≥ ${(threshold * 100).toFixed(0)}%</span>
        <strong>${stats.total ? `${stats.wins}勝 ${stats.losses}敗` : "尚無樣本"}</strong>
        <small>${stats.total ? `實際勝率 ${stats.winRate.toFixed(2)}%｜樣本 ${stats.total} 場` : "正式結算 0 場"}</small>
      </article>`;
    }).join("");

    const body = $("ai-snapshot-body");
    const rows = [...eligible].sort((a, b) => {
      const at = Date.parse(String(a.date_time_taipei || a.settled_at || "")) || 0;
      const bt = Date.parse(String(b.date_time_taipei || b.settled_at || "")) || 0;
      return bt - at;
    });

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="loading-cell">目前還沒有可驗證的 AI 賽前快照；部署後的新比賽會開始累積。</td></tr>';
      $("ai-snapshot-footer").textContent = "AI快照 0 場";
      return;
    }

    body.innerHTML = rows.map(row => {
      const snapshot = aiSnapshot(row);
      const verdict = aiDecisionResult(row);
      const decisionClass = snapshot.decision === "支持"
        ? "support"
        : snapshot.decision === "警示"
          ? "warning"
          : "hold";
      const leagueInfo = compactLeague(row);
      const homeRank = num(row.home_rank);
      const awayRank = num(row.away_rank);
      const homeBetter = homeRank !== null && awayRank !== null && homeRank < awayRank;
      const awayBetter = homeRank !== null && awayRank !== null && awayRank < homeRank;
      const homeIsHot = hotSideIsHome(row);
      const awayIsHot = String(row?.hot_side || "") === "客場";
      const score = num(row.home_score) !== null && num(row.away_score) !== null
        ? `${Number(row.home_score)} : ${Number(row.away_score)}`
        : "—";
      const model = String(snapshot.model_version || "—");
      const dataset = num(snapshot.dataset_matches);
      const modelText = dataset !== null ? `${model}｜${dataset}場` : model;
      return `<tr>
        <td>${escapeHtml(row.date_time_taipei || row.date || "—")}</td>
        <td>
          <div class="match-info-cell">
            <span class="meta-badge level">${escapeHtml(leagueInfo.level || "—")}</span>
            ${leagueInfo.round ? `<span class="meta-badge round">${escapeHtml(leagueInfo.round)}</span>` : ""}
          </div>
        </td>
        <td>${playerCell(row.home, row.home_rank, homeIsHot, homeBetter)}</td>
        <td>${playerCell(row.away, row.away_rank, awayIsHot, awayBetter)}</td>
        <td><span class="ai-prediction-pill ${decisionClass}">試判${escapeHtml(snapshot.decision)} ${ratioPct(snapshot.probability)}</span></td>
        <td class="ai-model-cell">${escapeHtml(modelText)}</td>
        <td class="score">${score}</td>
        <td><span class="ai-verdict ${verdict.className}">${escapeHtml(verdict.label)}</span></td>
      </tr>`;
    }).join("");

    const supportText = support.accuracy !== null ? `支持 ${support.accuracy.toFixed(1)}%` : "支持 —";
    const warningText = warning.accuracy !== null ? `警示 ${warning.accuracy.toFixed(1)}%` : "警示 —";
    $("ai-snapshot-footer").textContent = `可驗證 ${rows.length} 場｜${supportText}｜${warningText}｜AI≥80% ${at80.winRate !== null ? `${at80.winRate.toFixed(1)}%` : "—"}`;
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
      const grades = ["A", "B", "C", "淘汰", "未評級"];
      const wins = grades.reduce((sum, g) => sum + (s?.grades?.[g]?.wins || 0), 0);
      const losses = grades.reduce((sum, g) => sum + (s?.grades?.[g]?.losses || 0), 0);
      const total = wins + losses;
      const allHtml = total
        ? `<div class="record"><strong>${wins}勝 ${losses}敗</strong><small>${pct((wins / total) * 100)}</small></div>`
        : '<span class="record empty">—</span>';
      return `<tr>
        <td><strong>${escapeHtml(day.date)}</strong></td>
        <td>${allHtml}</td>
        <td>${recordHtml(s?.grades?.A, "A")}</td>
        <td>${recordHtml(s?.grades?.B, "B")}</td>
        <td>${recordHtml(s?.grades?.C, "C")}</td>
        <td>${recordHtml(s?.grades?.淘汰, "淘汰")}</td>
        <td>${Number(s?.special || 0)}</td>
      </tr>`;
    }).join("");
  }

  function compactLeague(row) {
    const level = String(row?.league_compact || row?.league || "").trim();
    const round = String(row?.round_compact || "").trim();
    return { level, round, text: [level, round].filter(Boolean).join(" ｜ ") || "—" };
  }

  function rankPill(rank, side) {
    const n = num(rank);
    if (n === null || n <= 0) return '<span class="rank-pill missing">#—</span>';
    let tier = "rarity-c";
    let rarity = "C";
    if (n <= 10) { tier = "rarity-ssr"; rarity = "SSR"; }
    else if (n <= 50) { tier = "rarity-sr"; rarity = "SR"; }
    else if (n <= 250) { tier = "rarity-r"; rarity = "R"; }
    else if (n <= 500) { tier = "rarity-n"; rarity = "N"; }
    const better = side === "better" ? " better-ranked" : "";
    return `<span class="rank-pill ${tier}${better}" title="${rarity}｜世界排名 #${n}">#${n}</span>`;
  }

  function playerCell(name, rank, isHot = false, isBetter = false) {
    const safeName = escapeHtml(name || "—");
    const hotClass = isHot ? " hot-player" : "";
    return `<div class="player-cell${hotClass}"><span class="player-name">${safeName}</span>${rankPill(rank, isBetter ? "better" : "normal")}</div>`;
  }

  function hotSideIsHome(row) {
    return String(row?.hot_side || "") === "主場";
  }

  function rankGapText(value) {
    const gap = num(value);
    if (gap === null) return '<span class="rank-gap-text missing">—</span>';
    if (gap > 0) return `<span class="rank-gap-text good">熱門前 ${Math.abs(gap)}</span>`;
    if (gap < 0) return `<span class="rank-gap-text bad">熱門後 ${Math.abs(gap)}</span>`;
    return '<span class="rank-gap-text neutral">同排名</span>';
  }

  function dSignalClass(row) {
    if (row?.d_signal_class) return String(row.d_signal_class);
    const value = num(row?.d_value);
    if (value === null) return "neutral";
    if (value > 0.4) return "hot-strong";
    if (value > 0) return "hot";
    if (value < -0.4) return "cold-strong";
    if (value < 0) return "cold";
    return "neutral";
  }

  function dSignalLabel(row) {
    if (row?.d_signal) return String(row.d_signal);
    const signal = dSignalClass(row);
    return ({
      "hot-strong": "D++",
      hot: "D+",
      cold: "D-",
      "cold-strong": "D--",
      neutral: "D0",
    })[signal] || "D?";
  }

  function dPill(row) {
    const label = dSignalLabel(row);
    const signal = dSignalClass(row);
    const value = num(row?.d_value);
    const title = value === null ? "D 值不足" : `D數值 ${value.toFixed(3)}`;
    return `<span class="d-pill ${escapeHtml(signal)}" title="${escapeHtml(title)}">${escapeHtml(label)}</span>`;
  }

  function filteredMatches() {
    const grade = $("grade-filter").value;
    const result = $("result-filter").value;
    const probabilityMinRaw = $("probability-filter").value;
    const probabilityMin = probabilityMinRaw === "全部" ? null : Number(probabilityMinRaw);
    const q = $("search-input").value.trim().toLowerCase();

    return state.matches.filter(row => {
      if (grade !== "全部" && normalizedRating(row) !== grade) return false;
      if (result !== "全部" && resultLabel(row) !== result) return false;
      if (probabilityMin !== null) {
        const probability = ratioNumber(row.rating_probability);
        if (probability === null || probability < probabilityMin) return false;
      }
      if (q) {
        const leagueInfo = compactLeague(row).text;
        const hay = [
          row.home, row.away, row.hot_player, row.league, leagueInfo,
          row.date_time_taipei, normalizedRating(row), dSignalLabel(row),
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function sortValue(row, key) {
    if (key === "date_time_taipei") return Date.parse(String(row.date_time_taipei || row.date || row.settled_at || "")) || 0;
    if (key === "league_compact") return compactLeague(row).text.toLowerCase();
    if (key === "home") return String(row.home || "").toLowerCase();
    if (key === "away") return String(row.away || "").toLowerCase();
    if (key === "hot_odds") return num(row.hot_odds) ?? -Infinity;
    if (key === "rating_probability") return ratioNumber(row.rating_probability) ?? -Infinity;
    if (key === "rank_gap_abs") return num(row.rank_gap_abs) ?? -Infinity;
    if (key === "rating_ev") return ratioNumber(row.rating_ev) ?? -Infinity;
    if (key === "rating") {
      const gradeScore = gradeOrderValue(normalizedRating(row));
      const dScore = ({ "D++": 5, "D+": 4, "D0": 3, "D-": 2, "D--": 1 })[dSignalLabel(row)] || 0;
      return gradeScore * 10 + dScore;
    }
    if (key === "score") {
      const home = num(row.home_score);
      const away = num(row.away_score);
      return home !== null && away !== null ? home * 10 + away : -Infinity;
    }
    if (key === "result") return ({ 勝: 3, 敗: 2, 特殊: 1 })[resultLabel(row)] || 0;
    return String(row?.[key] ?? "").toLowerCase();
  }

  function sortedMatches(rows) {
    const direction = state.sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValue(a, state.sortKey);
      const bv = sortValue(b, state.sortKey);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
      return String(av).localeCompare(String(bv), "zh-Hant", { numeric: true, sensitivity: "base" }) * direction;
    });
  }

  function updateSortHeaders() {
    document.querySelectorAll(".detail-table th[data-sort-key]").forEach(th => {
      const active = th.dataset.sortKey === state.sortKey;
      th.classList.toggle("sort-active", active);
      th.setAttribute("aria-sort", active ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
      const indicator = th.querySelector(".sort-indicator");
      if (indicator) indicator.textContent = active ? (state.sortDir === "asc" ? "▲" : "▼") : "↕";
    });
  }

  function renderDetails() {
    const body = $("detail-body");
    const filtered = filteredMatches();
    const rows = sortedMatches(filtered);
    updateSortHeaders();

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="9" class="loading-cell">目前篩選條件沒有結算場次。</td></tr>';
      $("detail-footer").textContent = "顯示 0 場";
      return;
    }

    body.innerHTML = rows.map(row => {
      const label = resultLabel(row);
      const resultClass = label === "勝" ? "win" : label === "敗" ? "loss" : "special";
      const score = num(row.home_score) !== null && num(row.away_score) !== null
        ? `${Number(row.home_score)} : ${Number(row.away_score)}`
        : "—";
      const probability = ratioNumber(row.rating_probability);
      const probabilityClass = probability !== null && probability >= 0.65 ? " threshold-hit" : "";
      const reason = label === "特殊" && row.reason ? `<span class="special-reason">${escapeHtml(row.reason)}</span>` : "";
      const leagueInfo = compactLeague(row);
      const homeIsHot = hotSideIsHome(row);
      const awayIsHot = String(row?.hot_side || "") === "客場";
      const homeRank = num(row.home_rank);
      const awayRank = num(row.away_rank);
      const homeBetter = homeRank !== null && awayRank !== null && homeRank < awayRank;
      const awayBetter = homeRank !== null && awayRank !== null && awayRank < homeRank;
      return `<tr>
        <td>${escapeHtml(row.date_time_taipei || row.date || "—")}</td>
        <td>
          <div class="match-info-cell">
            <span class="meta-badge level">${escapeHtml(leagueInfo.level || "—")}</span>
            ${leagueInfo.round ? `<span class="meta-badge round">${escapeHtml(leagueInfo.round)}</span>` : ""}
          </div>
        </td>
        <td>${playerCell(row.home, row.home_rank, homeIsHot, homeBetter)}</td>
        <td>${playerCell(row.away, row.away_rank, awayIsHot, awayBetter)}</td>
        <td class="metric${probabilityClass}">${ratioPct(row.rating_probability)}</td>
        <td class="metric">${ratioPct(row.rating_ev, 2, true)}</td>
        <td>
          <div class="rating-d-wrap">
            <span class="grade-pill ${escapeHtml(normalizedRating(row))}">${escapeHtml(normalizedRating(row))}</span>
            ${dPill(row)}
          </div>
        </td>
        <td class="score">${score}</td>
        <td><span class="result-pill ${resultClass}">${label === "特殊" ? "特殊" : `熱門方${label}`}</span>${reason}</td>
      </tr>`;
    }).join("");

    const probabilityLabel = $("probability-filter").value === "全部"
      ? "全部評級勝率"
      : `評級勝率 ≥ ${(Number($("probability-filter").value) * 100).toFixed(0)}%`;
    $("detail-footer").textContent = `${probabilityLabel}｜顯示 ${rows.length}／${state.matches.length} 場｜排序：${state.sortDir === "asc" ? "小→大" : "大→小"}`;
  }

  async function loadPerformance(days = state.days) {
    state.days = days;
    $("status-text").textContent = days === "all"
      ? "正在讀取全部 R2 正式結算資料……"
      : `正在讀取近 ${days} 日 R2 正式結算資料……`;
    $("refresh-button").disabled = true;

    try {
      const response = await fetch(`${WORKER_URL}/performance/results?days=${encodeURIComponent(days)}&v=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);

      state.payload = payload;
      state.matches = Array.isArray(payload.matches) ? payload.matches : [];
      updateSummary(payload);
      renderThresholds();
      renderAiValidation();
      renderDaily(payload);
      renderDetails();
      const range = payload.date_from && payload.date_to ? `${payload.date_from} ～ ${payload.date_to}` : "尚無日期";
      $("status-text").textContent = `${range}｜正式 ${payload?.summary?.completed || 0} 場｜特殊 ${payload?.summary?.special || 0} 場｜資料由 R2 settlement/results 整合`;
    } catch (error) {
      $("status-text").textContent = `戰績讀取失敗：${error?.message || error}`;
      $("daily-body").innerHTML = `<tr><td colspan="7" class="loading-cell">${escapeHtml(error?.message || String(error))}</td></tr>`;
      $("detail-body").innerHTML = '<tr><td colspan="9" class="loading-cell">請確認 Cloudflare Worker 已部署含排名／D欄位的新版 /performance/results。</td></tr>';
      $("probability-threshold-cards").innerHTML = '<div class="loading-cell">門檻統計讀取失敗。</div>';
      $("ai-threshold-cards").innerHTML = '<div class="loading-cell">AI快照統計讀取失敗。</div>';
      $("ai-snapshot-body").innerHTML = '<tr><td colspan="8" class="loading-cell">AI快照讀取失敗。</td></tr>';
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
    ["grade-filter", "result-filter", "probability-filter", "search-input"].forEach(id => {
      $(id).addEventListener(id === "search-input" ? "input" : "change", renderDetails);
    });

    document.querySelectorAll(".detail-table th[data-sort-key]").forEach(th => {
      th.addEventListener("click", () => {
        const key = th.dataset.sortKey;
        if (!key) return;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = ["rating_probability", "rating_ev", "rating", "date_time_taipei", "score", "result", "hot_odds", "rank_gap_abs"].includes(key)
            ? "desc"
            : "asc";
        }
        renderDetails();
      });
    });

    loadPerformance("7");
  });
})();
