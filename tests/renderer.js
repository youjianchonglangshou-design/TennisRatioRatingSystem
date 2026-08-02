(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TennisRatioRenderer = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const RAW_METRICS = [
    { key: "win_percentage", label: "勝率", value_format: "percentage", lower_is_better: false },
    { key: "service_games_won_ratio", label: "保發率／局", value_format: "percentage", lower_is_better: false },
    { key: "return_games_won_ratio", label: "破發率／局", value_format: "percentage", lower_is_better: false },
    { key: "first_serve_accuracy", label: "一發進球率", value_format: "percentage", lower_is_better: false },
    { key: "first_serve_points", label: "一發得分率", value_format: "percentage", lower_is_better: false },
    { key: "second_serve_points", label: "二發得分率", value_format: "percentage", lower_is_better: false },
    { key: "return_1st_serve_points", label: "接一發得分", value_format: "percentage", lower_is_better: false },
    { key: "return_2nd_serve_points", label: "接二發得分", value_format: "percentage", lower_is_better: false },
    { key: "breakpoints_saved_ratio", label: "破發點挽救", value_format: "percentage", lower_is_better: false },
    { key: "breakpoints_converted_ratio", label: "破發點轉換", value_format: "percentage", lower_is_better: false },
    { key: "dominance_ratio", label: "Dominance", value_format: "ratio", lower_is_better: false },
    { key: "match_eff_ratio", label: "Match Efficiency", value_format: "ratio", lower_is_better: false },
    { key: "serve_pressure_avg", label: "發球壓力", value_format: "percentage", lower_is_better: false },
    { key: "return_pressure_avg", label: "接發壓力", value_format: "percentage", lower_is_better: false },
    { key: "doublefaults_per_match", label: "雙誤／場", value_format: "per_match", lower_is_better: true }
  ];

  const RATING_LABELS = {
    win: "近期勝率",
    game: "保發與破發能力",
    point: "發球與接發得分",
    breakpoint: "破發點表現",
    efficiency: "整體比賽效率"
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#x27;");
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function integer(value) {
    const number = finiteNumber(value);
    return number === null ? null : Math.trunc(number);
  }

  function pct(value, digits = 2, signed = false) {
    const number = finiteNumber(value);
    if (number === null) return "—";
    const percentage = number * 100;
    const prefix = signed && percentage > 0 ? "+" : "";
    return `${prefix}${percentage.toFixed(digits)}%`;
  }

  function odds(value) {
    const number = finiteNumber(value);
    return number === null ? "—" : number.toFixed(3);
  }

  function numberText(value, digits = 3, signed = false) {
    const number = finiteNumber(value);
    if (number === null) return "—";
    const prefix = signed && number > 0 ? "+" : "";
    return `${prefix}${number.toFixed(digits)}`;
  }

  function sortableValue(value, numeric = false) {
    if (numeric) {
      const number = finiteNumber(value);
      return number === null ? "-999999999" : number.toFixed(12);
    }
    return String(value ?? "").toLocaleLowerCase("zh-Hant");
  }

  function normalizeName(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en-US")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]/g, "");
  }

  function nameTokens(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en-US")
      .match(/[a-z0-9]+/g) || [];
  }

  function levenshteinDistance(left, right) {
    const a = String(left);
    const b = String(right);
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = new Array(b.length + 1);
    for (let i = 1; i <= a.length; i += 1) {
      current[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + cost
        );
      }
      for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
    }
    return previous[b.length];
  }

  function similarity(left, right) {
    const a = normalizeName(left);
    const b = normalizeName(right);
    if (a && a === b) return 1;
    if (!a || !b) return 0;
    return 1 - levenshteinDistance(a, b) / Math.max(a.length, b.length);
  }

  function compatibleName(expected, actual) {
    const expectedTokens = nameTokens(expected);
    const actualTokens = nameTokens(actual);
    if (!expectedTokens.length || !actualTokens.length) return false;
    if (normalizeName(expected) === normalizeName(actual)) return true;
    const expectedSet = new Set(expectedTokens);
    const actualSet = new Set(actualTokens);
    const expectedSubset = [...expectedSet].every(token => actualSet.has(token));
    const actualSubset = [...actualSet].every(token => expectedSet.has(token));
    if (expectedSubset || actualSubset) return true;
    if (
      expectedTokens[0] === actualTokens[0] &&
      expectedTokens.at(-1) === actualTokens.at(-1)
    ) return true;
    if (
      expectedTokens.at(-1) === actualTokens.at(-1) &&
      Math.min(expectedTokens[0].length, actualTokens[0].length) >= 4 &&
      (
        expectedTokens[0].startsWith(actualTokens[0]) ||
        actualTokens[0].startsWith(expectedTokens[0])
      )
    ) return true;
    return similarity(expected, actual) >= 0.88;
  }

  function rankValue(row, side) {
    const key = side === "home" ? "主場名次" : "客場名次";
    const rank = integer(row?.[key]);
    return rank !== null && rank > 0 ? rank : null;
  }

  function rankPill(rank, { betterRanked = false } = {}) {
    if (rank === null || rank === undefined) {
      return '<span class="rank-pill missing">#—</span>';
    }
    let tier;
    let rarity;
    if (rank <= 10) [tier, rarity] = ["top10", "ssr"];
    else if (rank <= 50) [tier, rarity] = ["top50", "sr"];
    else if (rank <= 100) [tier, rarity] = ["top100", "r"];
    else if (rank <= 250) [tier, rarity] = ["top250", "r"];
    else if (rank <= 500) [tier, rarity] = ["top500", "n"];
    else [tier, rarity] = ["lower", "c"];
    const classes = ["rank-pill", tier, `rarity-${rarity}`];
    if (betterRanked) classes.push("better-ranked");
    return `<span class="${classes.join(" ")}" title="${rarity.toUpperCase()}｜世界排名 #${rank}">#${rank}</span>`;
  }

  function copyIcon(className = "copy-icon") {
    return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2.4"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>`;
  }

  function ratingClass(value) {
    const rating = String(value ?? "");
    if (rating === "A") return "a";
    if (rating === "B") return "b";
    if (rating === "C") return "c";
    if (rating.includes("淘汰")) return "x";
    if (rating.includes("過期")) return "expired";
    return "missing";
  }

  function dSignalStyle(dValue) {
    const score = finiteNumber(dValue);
    if (score === null) return ["neutral", "D值不足"];
    if (score > 0.4) return ["hot-strong", "D值明顯偏熱門方"];
    if (score > 0) return ["hot", "D值偏熱門方"];
    if (score < -0.4) return ["cold-strong", "D值明顯偏冷門方"];
    if (score < 0) return ["cold", "D值偏冷門方"];
    return ["neutral", "D值中性"];
  }

  function dSignalCompact(signalClass) {
    return ({
      "hot-strong": "D++",
      hot: "D+",
      cold: "D-",
      "cold-strong": "D--",
      neutral: "D0"
    })[signalClass] || "D?";
  }

  function overviewBiasFromCounts(hotValue, coldValue) {
    if (hotValue === null || coldValue === null) return "bias-neutral";
    if (hotValue > coldValue) return "bias-hot";
    if (coldValue > hotValue) return "bias-cold";
    return "bias-neutral";
  }

  function overviewBiasFromD(signalClass) {
    if (signalClass.startsWith("hot")) return "bias-hot";
    if (signalClass.startsWith("cold")) return "bias-cold";
    return "bias-neutral";
  }

  function overviewBiasFromEv(value) {
    if (value === null) return "bias-neutral";
    if (value > 0) return "bias-hot";
    if (value < 0) return "bias-cold";
    return "bias-neutral";
  }

  function overviewBiasFromGrade(value) {
    const text = String(value ?? "");
    if (["A", "B", "C"].includes(text)) return "bias-hot";
    if (text.includes("淘汰") || text.includes("過期")) return "bias-cold";
    return "bias-neutral";
  }

  function overviewBoxHtml(index, title, bodyHtml, {
    extraClasses = "",
    sideClass = "",
    labelTitle = ""
  } = {}) {
    const classes = ["overview-box", extraClasses, sideClass].filter(Boolean).join(" ");
    const labelAttr = labelTitle ? ` title="${escapeHtml(labelTitle)}"` : "";
    return `<div class="${classes}"><div class="overview-box-head"><span class="overview-index">${escapeHtml(index)}</span><span class="overview-box-label"${labelAttr}>${escapeHtml(title)}</span></div>${bodyHtml}</div>`;
  }

  function energyPointsHtml(hotCount, coldCount, {
    total,
    effectiveCount = null,
    title = ""
  }) {
    const safeTotal = Math.max(1, Math.trunc(total));
    const hot = Math.min(safeTotal, Math.max(0, Math.trunc(hotCount || 0)));
    const cold = Math.min(safeTotal, Math.max(0, Math.trunc(coldCount || 0)));
    if (effectiveCount !== null && effectiveCount <= 0) {
      return '<div class="energy-summary unavailable"><span class="overview-unavailable">資料不足</span></div>';
    }
    let direction;
    let directionText;
    let strength;
    let scoreText;
    if (hot > cold) {
      direction = "hot"; directionText = "熱門方"; strength = hot; scoreText = `${hot}/${safeTotal}`;
    } else if (cold > hot) {
      direction = "cold"; directionText = "冷門方"; strength = cold; scoreText = `${cold}/${safeTotal}`;
    } else {
      direction = "neutral"; directionText = "雙方持平"; strength = hot; scoreText = `${hot}：${cold}`;
    }
    const filledPoints = Math.round(strength / safeTotal * 15);
    const points = Array.from({ length: 15 }, (_, index) => {
      const fill = index < filledPoints ? 1 : 0;
      return `<i class="energy-dot ${fill ? "full" : "empty"}" style="--energy-fill:${(fill * 100).toFixed(3)}%"></i>`;
    }).join("");
    const detail = title || `熱門方 ${hot}/${safeTotal}；冷門方 ${cold}/${safeTotal}`;
    return `<div class="energy-summary ${direction}" title="${escapeHtml(detail)}" aria-label="${escapeHtml(detail)}"><span class="energy-direction">${directionText}<b>${scoreText}</b></span><span class="energy-track" aria-hidden="true">${points}</span></div>`;
  }

  function resolveRatingCounts({ model = {}, storedSummary = {}, fallbackHot = 0, fallbackCold = 0, fallbackTotal = 5 }) {
    const readInteger = (values, fallback) => {
      for (const value of values) {
        if (value === null || value === undefined) continue;
        const number = finiteNumber(value);
        if (number !== null) return Math.max(0, Math.trunc(number));
      }
      return Math.max(0, Math.trunc(fallback));
    };
    const hot = readInteger([
      model["熱門方五項較優數"],
      model["排名救援支持項數"],
      storedSummary["熱門方較優項數"]
    ], fallbackHot);
    const cold = readInteger([storedSummary["對手較優項數"]], fallbackCold);
    const total = readInteger([
      model["五項比較數"],
      model["排名救援比較項數"],
      storedSummary["總項目數"],
      storedSummary["有效比較項數"]
    ], fallbackTotal);
    return [hot, cold, Math.max(total, hot + cold)];
  }

  function isColdCandidate(row) {
    const model = row?.["模型"] && typeof row["模型"] === "object" ? row["模型"] : {};
    const dScore = finiteNumber(model["D數據差"]);
    const hotSupport = integer(model["熱門方五項較優數"]) || 0;
    const componentCount = integer(model["五項比較數"]) || 0;
    const coldSupport = Math.max(0, componentCount - hotSupport);
    const hotOdds = finiteNumber(row?.["熱門方賠率"]);
    const rating = String(row?.["評級"] ?? "");
    const ratingOk = rating === "C" || rating.includes("淘汰");
    return Boolean(
      dScore !== null && dScore < 0 && componentCount > 0 &&
      coldSupport === componentCount && ratingOk &&
      hotOdds !== null && hotOdds >= 1.5 && hotOdds <= 1.75
    );
  }

  function rawBreadthCounts(row, { scope }) {
    const raw = row?.["原始指標比較"] && typeof row["原始指標比較"] === "object" ? row["原始指標比較"] : null;
    const scopeKey = scope === "main" ? "Main Tour｜同場地" : "All Levels｜同場地";
    if (!raw) return [null, null, null, scopeKey];
    const section = raw[scopeKey];
    if (!section || typeof section !== "object") return [null, null, null, scopeKey];
    const summary = section["統計"];
    if (!summary || typeof summary !== "object") return [null, null, null, scopeKey];
    const hotCount = integer(summary["熱門方較優項數"]);
    const coldCount = integer(summary["對手較優項數"]);
    const effective = integer(summary["有效比較項數"]);
    if (hotCount !== null && coldCount !== null) return [hotCount, coldCount, effective, scopeKey];
    const homeCount = integer(summary["主場較優項數"]);
    const awayCount = integer(summary["客場較優項數"]);
    if (homeCount === null || awayCount === null) return [null, null, effective, scopeKey];
    return row?.["熱門方位置"] === "客場"
      ? [awayCount, homeCount, effective, scopeKey]
      : [homeCount, awayCount, effective, scopeKey];
  }

  function dataMixWeights(model) {
    const readWeight = key => {
      const value = finiteNumber(model?.[key]);
      return value === null ? null : Math.min(1, Math.max(0, value));
    };
    let mainWeight = readWeight("Main權重");
    let allWeight = readWeight("All Levels權重");
    if (mainWeight === null && allWeight === null) return [1, 0];
    if (mainWeight === null) mainWeight = 1 - allWeight;
    if (allWeight === null) allWeight = 1 - mainWeight;
    const total = allWeight + mainWeight;
    if (total <= 0) return [1, 0];
    return [allWeight / total, mainWeight / total];
  }

  function statSource(player, key) {
    const source = player?.[key] && typeof player[key] === "object" ? player[key] : {};
    return source?.stats && typeof source.stats === "object" ? source.stats : {};
  }

  function comparisonWinner(homeStats, awayStats, key, { lowerIsBetter = false } = {}) {
    const homeValue = finiteNumber(homeStats?.[key]);
    const awayValue = finiteNumber(awayStats?.[key]);
    if (homeValue === null || awayValue === null || homeValue === awayValue) return null;
    if (lowerIsBetter) return homeValue < awayValue ? "home" : "away";
    return homeValue > awayValue ? "home" : "away";
  }

  function comparisonCell(statsValue, otherStats, key, {
    percentage,
    lowerIsBetter = false,
    isBetterOverride = null
  }) {
    const value = finiteNumber(statsValue?.[key]);
    const isBetter = isBetterOverride === null
      ? comparisonWinner(statsValue, otherStats, key, { lowerIsBetter }) === "home"
      : isBetterOverride;
    let text = "—";
    if (value !== null) {
      if (percentage) text = `${value.toFixed(1)}%`;
      else if (["dominance_ratio", "match_eff_ratio"].includes(key)) text = value.toFixed(3);
      else text = value.toFixed(1);
    }
    return `<td class="${isBetter ? "metric-best" : ""}">${escapeHtml(text)}</td>`;
  }

  function statsComparisonPanel({
    title,
    homeStats,
    awayStats,
    homeName,
    awayName,
    homeRank,
    awayRank,
    homeBetter,
    awayBetter,
    hotName = "",
    storedComparison = null
  }) {
    const metrics = RAW_METRICS
      .filter(spec => spec.key !== "win_percentage")
      .map(spec => [spec.key, spec.label, spec.value_format === "percentage", Boolean(spec.lower_is_better)]);
    const stored = storedComparison && typeof storedComparison === "object" ? storedComparison : {};
    const storedItems = new Map(
      (Array.isArray(stored["項目"]) ? stored["項目"] : [])
        .filter(item => item && typeof item === "object" && item.key)
        .map(item => [String(item.key), item])
    );
    const storedSummary = stored["統計"] && typeof stored["統計"] === "object" ? stored["統計"] : {};
    const storedBetter = (key, position) => {
      const item = storedItems.get(key);
      return item ? item["較優位置"] === position : null;
    };
    const scoredMetrics = [["win_percentage", false], ...metrics.map(([key, _label, _percentage, lower]) => [key, lower])];
    const winners = scoredMetrics
      .map(([key, lower]) => comparisonWinner(homeStats, awayStats, key, { lowerIsBetter: lower }))
      .filter(Boolean);
    const hasStoredTotals = storedSummary["有效比較項數"] !== null && storedSummary["有效比較項數"] !== undefined;
    let homeTotal;
    let awayTotal;
    let hasTotals;
    if (hasStoredTotals) {
      homeTotal = integer(storedSummary["主場較優項數"]) || 0;
      awayTotal = integer(storedSummary["客場較優項數"]) || 0;
      hasTotals = Boolean(integer(storedSummary["有效比較項數"]));
    } else {
      homeTotal = winners.filter(item => item === "home").length;
      awayTotal = winners.filter(item => item === "away").length;
      hasTotals = Boolean(winners.length);
    }
    const homeTotalText = hasTotals ? String(homeTotal) : "—";
    const awayTotalText = hasTotals ? String(awayTotal) : "—";
    const homeTotalClass = hasTotals && homeTotal > awayTotal ? "metric-best stat-total" : "stat-total";
    const awayTotalClass = hasTotals && awayTotal > homeTotal ? "metric-best stat-total" : "stat-total";
    const homePlayerClass = hotName && compatibleName(hotName, homeName) ? "panel-player favorite" : "panel-player";
    const awayPlayerClass = hotName && compatibleName(hotName, awayName) ? "panel-player favorite" : "panel-player";
    const recordHome = Object.keys(homeStats || {}).length
      ? `${Math.trunc(finiteNumber(homeStats.matches_won) || 0)}-${Math.trunc(finiteNumber(homeStats.matches_lost) || 0)}`
      : "—";
    const recordAway = Object.keys(awayStats || {}).length
      ? `${Math.trunc(finiteNumber(awayStats.matches_won) || 0)}-${Math.trunc(finiteNumber(awayStats.matches_lost) || 0)}`
      : "—";
    const metricRows = metrics.map(([key, label, percentage, lowerIsBetter]) => (
      `<tr><th>${escapeHtml(label)}</th>` +
      comparisonCell(homeStats, awayStats, key, {
        percentage,
        lowerIsBetter,
        isBetterOverride: storedBetter(key, "主場")
      }) +
      comparisonCell(awayStats, homeStats, key, {
        percentage,
        lowerIsBetter,
        isBetterOverride: storedBetter(key, "客場")
      }) +
      "</tr>"
    )).join("");
    return `<section class="stats-panel" aria-label="${escapeHtml(title)}"><table class="compare-table"><thead><tr class="summary-row"><th>樣本</th><td class="player-record">${escapeHtml(recordHome)}</td><td class="player-record">${escapeHtml(recordAway)}</td></tr><tr class="summary-row"><th>勝率</th>${comparisonCell(homeStats, awayStats, "win_percentage", { percentage: true, isBetterOverride: storedBetter("win_percentage", "主場") })}${comparisonCell(awayStats, homeStats, "win_percentage", { percentage: true, isBetterOverride: storedBetter("win_percentage", "客場") })}</tr><tr class="player-row"><th>選手</th><th><span class="${homePlayerClass}">${escapeHtml(homeName)}${rankPill(homeRank, { betterRanked: homeBetter })}</span></th><th><span class="${awayPlayerClass}">${escapeHtml(awayName)}${rankPill(awayRank, { betterRanked: awayBetter })}</span></th></tr></thead><tbody><tr class="stats-total-row"><th>統計</th><td class="${homeTotalClass}">${escapeHtml(homeTotalText)}</td><td class="${awayTotalClass}">${escapeHtml(awayTotalText)}</td></tr>${metricRows}</tbody></table></section>`;
  }

  function ratioContext(row) {
    const ratio = row?.["TennisRatio"] && typeof row["TennisRatio"] === "object" ? row["TennisRatio"] : {};
    const home = ratio["主場球員"] && typeof ratio["主場球員"] === "object" ? ratio["主場球員"] : {};
    const away = ratio["客場球員"] && typeof ratio["客場球員"] === "object" ? ratio["客場球員"] : {};
    const homeName = String(home["正式姓名"] || row?.["主場"] || "主場球員");
    const awayName = String(away["正式姓名"] || row?.["客場"] || "客場球員");
    const homeRank = home.rank || row?.["主場名次"];
    const awayRank = away.rank || row?.["客場名次"];
    return [ratio, home, away, homeName, awayName, homeRank, awayRank];
  }

  function h2hTitleBlock(ratio, home, away) {
    const url = String(ratio?.h2h_url || home?.h2h_url || away?.h2h_url || "").trim();
    if (!url) return '<div class="h2h-title missing-url">H2H 尚未取得</div>';
    const escaped = escapeHtml(url);
    return `<div class="h2h-title" title="${escaped}"><span>H2H</span><a href="${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a><button type="button" class="copy-url h2h-title-copy" data-copy="${escaped}" title="複製H2H網址" aria-label="複製H2H網址">${copyIcon()}</button><em class="copy-status" aria-live="polite"></em></div>`;
  }

  function matchDetail(row) {
    const info = row?.["比賽資訊"] && typeof row["比賽資訊"] === "object" ? row["比賽資訊"] : {};
    const entries = [
      ["Pinnacle聯賽", row?.["聯賽"]],
      ["層級", info.tournament_level],
      ["輪次", info.round_name],
      ["場地", info.surface],
      ["場地來源", info.surface_source],
      ["Pinnacle時間", row?.["日期時間"]],
      ["分析狀態", row?.["分析狀態"]]
    ];
    const details = entries.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "—")}</dd>`).join("");
    return `<div class="tip-title">比賽資訊</div><dl class="info-list">${details}</dl>`;
  }

  function matchSummary(row) {
    const info = row?.["比賽資訊"] && typeof row["比賽資訊"] === "object" ? row["比賽資訊"] : {};
    const ratio = row?.["TennisRatio"] && typeof row["TennisRatio"] === "object" ? row["TennisRatio"] : {};
    const parts = [
      String(info.tournament_level || row?.["聯賽"] || "—"),
      String(info.round_name || "—"),
      String(info.surface || ratio["場地"] || "—")
    ];
    const visible = parts.map(part => `<span class="info-part">${escapeHtml(part)}</span>`).join('<i class="info-sep">|</i>');
    return [parts.join(" "), visible];
  }

  function copyMatchDate(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    return text.split("T", 1)[0].split(" ", 1)[0];
  }

  function ratingUiText(value) {
    return String(value ?? "")
      .replaceAll("Formula B", "評級")
      .replaceAll("FormulaB", "評級")
      .replaceAll("公式B", "評級");
  }

  function modelDetail(row, { embedded = false } = {}) {
    const model = row?.["模型"] && typeof row["模型"] === "object" ? row["模型"] : {};
    const items = Array.isArray(model["項目計算"]) ? model["項目計算"] : [];
    const storedRating = row?.["評級五項比較"] && typeof row["評級五項比較"] === "object" ? row["評級五項比較"] : {};
    const storedItems = new Map(
      (Array.isArray(storedRating["項目"]) ? storedRating["項目"] : [])
        .filter(item => item && typeof item === "object" && item.key)
        .map(item => [String(item.key), item])
    );
    const storedSummary = storedRating["統計"] && typeof storedRating["統計"] === "object" ? storedRating["統計"] : {};

    const displayItemValue = (item, key) => {
      const format = String(item?.value_format || "");
      const digits = format === "ratio" ? 3 : 1;
      const suffix = format.startsWith("percentage") ? "%" : "";
      const value = numberText(item?.[key], digits);
      return value !== "—" ? `${value}${suffix}` : value;
    };
    const displayDifference = item => {
      const format = String(item?.value_format || "");
      const digits = format === "ratio" ? 4 : 1;
      const suffix = format.startsWith("percentage") ? "%" : "";
      const value = numberText(item?.["差值"], digits, true);
      return value !== "—" ? `${value}${suffix}` : value;
    };

    const componentParts = [];
    let hotBetterCount = 0;
    let coldBetterCount = 0;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const key = String(item.key || "");
      const storedItem = storedItems.get(key);
      let verdict;
      let verdictClass;
      if (storedItem) {
        verdict = String(storedItem["判讀"] || "資料不足");
        const betterRole = storedItem["較優方"];
        verdictClass = betterRole === "熱門方" ? "hot-better" : betterRole === "對手" ? "cold-better" : "";
        if (betterRole === "熱門方") hotBetterCount += 1;
        else if (betterRole === "對手") coldBetterCount += 1;
      } else {
        const difference = finiteNumber(item["差值"]);
        if (difference === null) { verdict = "資料不足"; verdictClass = ""; }
        else if (difference > 0) { verdict = "熱門方較好"; verdictClass = "hot-better"; hotBetterCount += 1; }
        else if (difference < 0) { verdict = "對手較好"; verdictClass = "cold-better"; coldBetterCount += 1; }
        else { verdict = "雙方相同"; verdictClass = ""; }
      }
      const label = (storedItem ? String(storedItem["名稱"] || "") : "") || RATING_LABELS[key] || String(item.label || key || "—");
      componentParts.push(`<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(displayItemValue(item, "熱門方值"))}</td><td>${escapeHtml(displayItemValue(item, "對手值"))}</td><td class="${verdictClass}" title="差值 ${escapeHtml(displayDifference(item))}">${escapeHtml(verdict)}</td></tr>`);
    }
    let comparisonCount;
    [hotBetterCount, coldBetterCount, comparisonCount] = resolveRatingCounts({
      model,
      storedSummary,
      fallbackHot: hotBetterCount,
      fallbackCold: coldBetterCount,
      fallbackTotal: items.length || 5
    });
    const componentRows = componentParts.join("") || '<tr><td colspan="4" class="empty-comparison">評級比較資料尚未完成</td></tr>';
    const hotName = row?.["熱門方"] || model["熱門方球員"] || "—";
    const formulaProbability = row?.["公式B勝率"] ?? row?.["評級勝率"];
    const marketProbability = row?.["Pinnacle去水勝率"] ?? model["Pinnacle去水勝率"];
    const ratingEv = row?.["公式B EV"] ?? row?.["評級EV"];
    const rawStatus = ratingUiText(model["排名情境"] || model["公式B狀態"] || row?.["公式B狀態"] || "資料判讀");
    const statusText = ({
      "排名救援": "排名好＋數據差｜有限救援",
      "排名確認": "排名好＋數據好｜小幅確認",
      "放棄區": "排名差＋數據差｜不救援",
      "數據逆排名": "排名差＋數據好｜降低排名扣分",
      "數據排名一致": "數據與排名同方向",
      "排名相同": "排名相同｜只看數據",
      "中性": "雙方條件接近"
    })[rawStatus] || rawStatus;
    const adjustmentValue = finiteNumber(model["數據排名修正"]);
    const dScore = finiteNumber(model["D數據差"]);
    const [dSignalClass, dSignalText] = dSignalStyle(dScore);
    const rankFactorValue = finiteNumber(model["排名作用比例"] ?? model["排名救援保留率"]);
    const rawRankSignal = model["原始排名訊號"] ?? model["原始排名救援項"];
    const actualRankAdjustment = model["實際排名修正"] ?? model["排名救援項"];
    const scenarioDescription = String(model["排名情境說明"] || "").trim();
    const scenarioAction = String(model["排名情境處置"] || "").trim();
    const [allLevelsWeight, mainWeight] = dataMixWeights(model);
    const dataMixText = `All Levels ${(allLevelsWeight * 100).toFixed(1)}%｜Main Tour ${(mainWeight * 100).toFixed(1)}%`;
    const defaultScope = mainWeight > allLevelsWeight ? "main" : "all";
    const mixReason = String(model["混合權重說明"] || model["數據使用說明"] || "依雙方Main Tour樣本自動混合").trim();
    const eventMainFactor = finiteNumber(model["賽事Main係數"]);
    const hotMainSample = finiteNumber(model["熱門方Main樣本"]);
    const coldMainSample = finiteNumber(model["對手Main樣本"]);
    const effectiveMainSample = finiteNumber(model["Main有效樣本"]);
    const mixMathParts = [];
    if (eventMainFactor !== null) mixMathParts.push(`賽事Main係數 ${pct(eventMainFactor, 0)}`);
    if (effectiveMainSample !== null) {
      // JavaScript does not support Python's :g directly; remove insignificant zeros.
      const compact = value => value === null ? "—" : Number(value.toFixed(6)).toString();
      mixMathParts.push(`雙方Main樣本 ${compact(hotMainSample)}／${compact(coldMainSample)}場`);
      mixMathParts.push(`調和有效樣本 ${effectiveMainSample.toFixed(2)}場`);
    }
    const mixMathText = mixMathParts.join(" × ");
    const mixCard = `<div class="data-mix-card"><div class="data-mix-head"><strong>本場混合資料比重</strong><span>下方五項一律使用此比例</span></div><div class="data-mix-values"><span class="mix-scope ${defaultScope === "all" ? "dominant" : ""}" title="${defaultScope === "all" ? "預設頁籤" : ""}">All Levels<b>${(allLevelsWeight * 100).toFixed(1)}%</b></span><span class="mix-scope ${defaultScope === "main" ? "dominant" : ""}" title="${defaultScope === "main" ? "預設頁籤" : ""}">Main Tour<b>${(mainWeight * 100).toFixed(1)}%</b></span></div><div class="data-mix-track" aria-label="All Levels與Main Tour混合比重"><i class="all-levels-weight" style="width:${(allLevelsWeight * 100).toFixed(3)}%"></i><i class="main-tour-weight" style="width:${(mainWeight * 100).toFixed(3)}%"></i></div><small>${escapeHtml(mixReason)}</small>${mixMathText ? `<small class="mix-math">${escapeHtml(mixMathText)}</small>` : ""}</div>`;
    const ratingDecision = row?.["評級判定"] && typeof row["評級判定"] === "object"
      ? row["評級判定"]
      : model["評級判定"] && typeof model["評級判定"] === "object"
        ? model["評級判定"]
        : {};
    const scenarioNote = `<div class="scenario-detail"><span>${escapeHtml(scenarioAction)}</span><small>原始排名訊號 ${escapeHtml(numberText(rawRankSignal, 4, true))} × 作用 ${pct(rankFactorValue)}＝實際排名修正 ${escapeHtml(numberText(actualRankAdjustment, 4, true))}。</small></div>`;
    let plainVerdict;
    if (scenarioDescription) plainVerdict = scenarioDescription;
    else if (rawStatus.includes("排名救援")) plainVerdict = "熱門方的同場地數據較弱但排名較前；系統仍會補回部分差距，但補回比例由五項支持度限制，避免排名單獨推翻全部數據。";
    else if (adjustmentValue !== null && adjustmentValue > 0.002) plainVerdict = "雙方數據與排名整體支持熱門方，因此向上修正熱門方勝率。";
    else if (adjustmentValue !== null && adjustmentValue < -0.002) plainVerdict = "比較數據較偏向對手，因此向下修正熱門方勝率。";
    else plainVerdict = "雙方數據接近，本場只對熱門方勝率做小幅修正。";
    const finalGrade = ratingDecision["最終評級"] || row?.["評級"] || "—";
    const supportSummaryHtml = energyPointsHtml(hotBetterCount, coldBetterCount, {
      total: 5,
      effectiveCount: comparisonCount,
      title: `熱門方 ${hotBetterCount}/5；冷門方 ${coldBetterCount}/5；有效比較 ${comparisonCount}/5`
    });
    const [hotRaw, coldRaw, breadthEffective, breadthScope] = rawBreadthCounts(row, { scope: defaultScope });
    let breadthLabelTitle = "";
    let breadthInlineHtml;
    if (hotRaw === null || coldRaw === null) {
      breadthInlineHtml = '<div class="overview-line"><span class="overview-unavailable">資料不足</span><span class="breadth-badge neutral">資料不足</span></div>';
    } else {
      const effectiveNote = breadthEffective !== null ? `；有效比較 ${breadthEffective}/15` : "";
      breadthLabelTitle = `依 ${breadthScope} 原始15項統計${effectiveNote}`;
      breadthInlineHtml = energyPointsHtml(hotRaw, coldRaw, {
        total: 15,
        effectiveCount: breadthEffective,
        title: `依 ${breadthScope} 原始15項統計；熱門方 ${hotRaw}/15；冷門方 ${coldRaw}/15${effectiveNote}`
      });
    }
    const dValueLabel = dScore !== null ? `D=${numberText(dScore, 3, true)}` : "D=—";
    const dSignalBadge = `<div class="overview-line"><span class="d-signal ${dSignalClass}" title="D值 ${escapeHtml(numberText(dScore, 3, true))}"><i class="d-dot"></i>${escapeHtml(dSignalText)}</span></div>`;
    const ratingEvValue = finiteNumber(ratingEv);
    const ratingEvClass = ratingEvValue !== null && ratingEvValue > 0 ? "positive" : ratingEvValue !== null && ratingEvValue < 0 ? "negative" : "neutral";
    const overviewCard = `<section class="formula-overview" aria-label="評級六項重點總覽"><div class="overview-grid">${overviewBoxHtml("01", "15項廣度", breadthInlineHtml, { extraClasses: "overview-breadth", sideClass: overviewBiasFromCounts(hotRaw, coldRaw), labelTitle: breadthLabelTitle })}${overviewBoxHtml("03", dValueLabel, dSignalBadge, { extraClasses: "overview-d", sideClass: overviewBiasFromD(dSignalClass) })}${overviewBoxHtml("04", "評級勝率", `<div class="overview-metric-value"><b>${pct(formulaProbability)}</b></div>`, { extraClasses: "overview-prob overview-metric", sideClass: "bias-prob" })}${overviewBoxHtml("02", "5項方向", supportSummaryHtml, { extraClasses: "overview-five", sideClass: overviewBiasFromCounts(hotBetterCount, coldBetterCount) })}${overviewBoxHtml("05", "評級EV", `<div class="overview-metric-value"><b class="${ratingEvClass}">${pct(ratingEv, 2, true)}</b></div>`, { extraClasses: "overview-ev overview-metric", sideClass: overviewBiasFromEv(ratingEvValue) })}${overviewBoxHtml("06", "最終評級", `<div class="overview-metric-value"><b class="formula-final-grade ${ratingClass(finalGrade)}">${escapeHtml(finalGrade)}</b></div>`, { extraClasses: "overview-final overview-metric", sideClass: overviewBiasFromGrade(finalGrade) })}</div><small class="overview-note">15項看廣度；5項決定支持方向；D值看差距強度；EV決定價格是否值得。</small></section>`;
    const content = `${overviewCard}${mixCard}<table class="formula-table"><thead><tr><th>比較項目</th><th>熱門方</th><th>對手</th><th>簡單判讀</th></tr></thead><tbody>${componentRows}</tbody></table><div class="plain-summary"><div class="plain-summary-head"><span class="signal-tag">情境：${escapeHtml(statusText)}</span><strong>本場修正 ${pct(model["數據排名修正"], 2, true)}</strong></div><p>${escapeHtml(plainVerdict)}</p><small><b>本場實際採用：${escapeHtml(dataMixText)}</b>。頁籤只負責查看，不會改變評級公式。</small>${scenarioNote}</div><div class="prob-grid"><span>市場基準勝率<small>去除莊家水位後</small><b>${pct(marketProbability)}</b></span><span>熱門方基本加分<small>固定基準</small><b>${pct(model["固定基準加值"], 2, true)}</b></span><span>數據與排名修正<small>雙方實力比較</small><b>${pct(model["數據排名修正"], 2, true)}</b></span><span>最後評級勝率<small>修正後結果</small><b>${pct(formulaProbability)}</b></span></div>`;
    if (embedded) {
      return `<div class="panel-title formula-panel-title"><div class="formula-title-subject"><span>評級｜熱門方勝率計算</span><strong>${escapeHtml(hotName)}</strong></div></div><div class="formula-content">${content}</div>`;
    }
    return `<div class="tip-title">評級｜熱門方勝率計算　${escapeHtml(hotName)}　評級勝率 ${pct(formulaProbability)}　${dSignalText}　最終 ${escapeHtml(finalGrade)}</div>${content}`;
  }

  function bo3PredictionPanel(row, { homeName, awayName }) {
    const prediction = row?.["BO3機械預測"] && typeof row["BO3機械預測"] === "object" ? row["BO3機械預測"] : {};
    if (prediction["狀態"] !== "complete") {
      const reason = prediction["原因"] || "評級或保發／破發資料尚未完成";
      return `<section class="bo3-card unavailable"><div class="bo3-head"><strong>BO3 機械預測</strong><span>固定演算｜非隨機</span></div><p>目前無法預測：${escapeHtml(reason)}</p></section>`;
    }
    const hotProjection = prediction["熱門方預測"] && typeof prediction["熱門方預測"] === "object" ? prediction["熱門方預測"] : {};
    const coldProjection = prediction["對手預測"] && typeof prediction["對手預測"] === "object" ? prediction["對手預測"] : {};
    const hotName = String(hotProjection["球員"] || prediction["熱門方球員"] || "");
    let homeProjection;
    let awayProjection;
    if (compatibleName(homeName, hotName)) [homeProjection, awayProjection] = [hotProjection, coldProjection];
    else if (compatibleName(awayName, hotName)) [homeProjection, awayProjection] = [coldProjection, hotProjection];
    else if (row?.["熱門方位置"] === "主場") [homeProjection, awayProjection] = [hotProjection, coldProjection];
    else [homeProjection, awayProjection] = [coldProjection, hotProjection];
    const playerCard = (projection, fallbackName) => {
      const playerName = String(projection?.["球員"] || fallbackName || "—");
      const isHot = projection?.["角色"] === "熱門方";
      const nameClass = isHot ? "bo3-player-name favorite" : "bo3-player-name";
      const role = isHot ? "熱門方" : "對手";
      return `<div class="bo3-player"><div class="${nameClass}">${escapeHtml(playerName)}<small>${escapeHtml(role)}｜總勝率 ${pct(projection?.["總勝率"])}</small></div><div class="bo3-outcomes"><span>2–0<b>${pct(projection?.["2比0機率"])}</b></span><span>2–1<b>${pct(projection?.["2比1機率"])}</b></span></div></div>`;
    };
    const expectedGamesNumber = finiteNumber(prediction["預估總局數"]);
    const expectedGames = expectedGamesNumber === null ? "—" : expectedGamesNumber.toFixed(1);
    return `<section class="bo3-card"><div class="bo3-head"><strong>BO3 機械預測</strong><span>固定演算｜非隨機</span></div><div class="bo3-players">${playerCard(homeProjection, homeName)}${playerCard(awayProjection, awayName)}</div><div class="bo3-footer"><span>兩盤結束<b>${pct(prediction["兩盤機率"])}</b></span><span>打滿三盤<b>${pct(prediction["三盤機率"])}</b></span><span>單盤搶七<b>${pct(prediction["單盤搶七機率"])}</b></span><span>預估總局<b>${escapeHtml(expectedGames)}</b></span></div></section>`;
  }

  function integratedCardDimensions(homeName, awayName) {
    const homeLength = String(homeName || "").trim().length;
    const awayLength = String(awayName || "").trim().length;
    const longest = Math.max(homeLength, awayLength);
    const combined = homeLength + awayLength;
    const extraLongest = Math.max(0, longest - 14);
    const extraCombined = Math.max(0, combined - 28);
    const statsMin = Math.min(900, 430 + extraLongest * 9 + extraCombined * 5);
    const cardWidth = Math.min(1800, Math.max(1260, statsMin + 720));
    return [cardWidth, statsMin];
  }

  function integratedAnalysis(row) {
    const [ratio, home, away, homeName, awayName, homeRankRaw, awayRankRaw] = ratioContext(row);
    const homeRank = integer(homeRankRaw);
    const awayRank = integer(awayRankRaw);
    const homeRankValue = homeRank !== null && homeRank > 0 ? homeRank : null;
    const awayRankValue = awayRank !== null && awayRank > 0 ? awayRank : null;
    const homeBetter = homeRankValue !== null && awayRankValue !== null && homeRankValue < awayRankValue;
    const awayBetter = homeRankValue !== null && awayRankValue !== null && awayRankValue < homeRankValue;
    const hotName = String(row?.["熱門方"] || "");
    const rawComparisons = row?.["原始指標比較"] && typeof row["原始指標比較"] === "object" ? row["原始指標比較"] : {};
    const allStored = rawComparisons["All Levels｜同場地"] && typeof rawComparisons["All Levels｜同場地"] === "object" ? rawComparisons["All Levels｜同場地"] : {};
    const mainStored = rawComparisons["Main Tour｜同場地"] && typeof rawComparisons["Main Tour｜同場地"] === "object" ? rawComparisons["Main Tour｜同場地"] : {};
    const allPanel = statsComparisonPanel({
      title: "All Levels｜同場地",
      homeStats: statSource(home, "all_surface"),
      awayStats: statSource(away, "all_surface"),
      homeName,
      awayName,
      homeRank: homeRankValue,
      awayRank: awayRankValue,
      homeBetter,
      awayBetter,
      hotName,
      storedComparison: allStored
    });
    const mainPanel = statsComparisonPanel({
      title: "Main Tour｜同場地",
      homeStats: statSource(home, "main_surface"),
      awayStats: statSource(away, "main_surface"),
      homeName,
      awayName,
      homeRank: homeRankValue,
      awayRank: awayRankValue,
      homeBetter,
      awayBetter,
      hotName,
      storedComparison: mainStored
    });
    const model = row?.["模型"] && typeof row["模型"] === "object" ? row["模型"] : {};
    const [allLevelsWeight, mainWeight] = dataMixWeights(model);
    const defaultScope = mainWeight > allLevelsWeight ? "main" : "all";
    const itemNumber = row?.["項次"];
    const itemText = itemNumber !== null && itemNumber !== undefined && itemNumber !== "" ? `項次${itemNumber}` : "項次—";
    const h2hTitle = h2hTitleBlock(ratio, home, away);
    return `<div class="tip-title integrated-title"><span>TennisRatio 雙方數據比較</span><strong>＋</strong><span class="integrated-rating-title">評級熱門方勝率</span>${h2hTitle}<span class="card-item">${escapeHtml(itemText)}</span></div><div class="surface">Last 52 Weeks｜${escapeHtml(ratio["場地"] || "場地待補")}　來源：${escapeHtml(ratio["場地來源"] || "待補")}</div><div class="analysis-grid"><section class="stats-tabs-shell" data-default-stats-tab="${defaultScope}"><div class="stats-tab-list" role="tablist" aria-label="TennisRatio數據範圍"><button type="button" class="stats-tab${defaultScope === "all" ? " active" : ""}" data-stats-tab="all" role="tab" aria-selected="${defaultScope === "all" ? "true" : "false"}">All Levels｜同場地</button><button type="button" class="stats-tab${defaultScope === "main" ? " active" : ""}" data-stats-tab="main" role="tab" aria-selected="${defaultScope === "main" ? "true" : "false"}">Main Tour｜同場地</button></div><div class="stats-tab-panel${defaultScope === "all" ? " active" : ""}" data-stats-panel="all" role="tabpanel">${allPanel}</div><div class="stats-tab-panel${defaultScope === "main" ? " active" : ""}" data-stats-panel="main" role="tabpanel">${mainPanel}</div>${bo3PredictionPanel(row, { homeName, awayName })}</section><section class="formula-section">${modelDetail(row, { embedded: true })}</section></div>`;
  }

  function renderRow(row, index) {
    const rowId = `r${index}`;
    const homeRank = rankValue(row, "home");
    const awayRank = rankValue(row, "away");
    const homeBetter = homeRank !== null && awayRank !== null && homeRank < awayRank;
    const awayBetter = homeRank !== null && awayRank !== null && awayRank < homeRank;
    const hotName = String(row?.["熱門方"] || "");
    const homeName = String(row?.["主場"] || "");
    const awayName = String(row?.["客場"] || "");
    const formulaProbability = row?.["公式B勝率"] ?? row?.["評級勝率"];
    const formulaEv = row?.["公式B EV"] ?? row?.["評級EV"];
    const model = row?.["模型"] && typeof row["模型"] === "object" ? row["模型"] : {};
    const dScore = finiteNumber(model["D數據差"]);
    const [dSignalClass, dSignalText] = dSignalStyle(dScore);
    const dCompact = dSignalCompact(dSignalClass);
    const coldCandidate = isColdCandidate(row);
    const [matchSort, summary] = matchSummary(row);
    const copyDate = copyMatchDate(row?.["日期時間"]);
    const homeLabel = hotName === homeName ? `<span class="favorite">${escapeHtml(homeName)}</span>` : escapeHtml(homeName);
    const awayLabel = hotName === awayName ? `<span class="favorite">${escapeHtml(awayName)}</span>` : escapeHtml(awayName);
    const rating = String(row?.["評級"] || "尚未分析");
    const searchText = ["項次", "日期時間", "聯賽", "主場", "客場", "熱門方", "評級", "分析狀態"]
      .map(key => String(row?.[key] || ""))
      .join(" ")
      .toLocaleLowerCase("zh-Hant");
    const [cardWidth, statsMin] = integratedCardDimensions(homeName, awayName);
    const rowHtml = `<tr data-rating="${escapeHtml(rating)}" data-d-signal="${escapeHtml(dSignalClass)}" data-cold-candidate="${coldCandidate ? "1" : "0"}" data-search="${escapeHtml(searchText)}"><td data-sort="${sortableValue(row?.["項次"], true)}">${escapeHtml(row?.["項次"])}</td><td data-sort="${sortableValue(row?.["日期時間"])}" class="date">${escapeHtml(row?.["日期時間"])}</td><td data-sort="${sortableValue(matchSort)}"><span class="hover info-pill" data-template="${rowId}-match" data-card-kind="match-card" tabindex="0">${summary}</span></td><td class="copy-column"><button type="button" class="copy-match" data-copy-kind="match" data-copy-date="${escapeHtml(copyDate)}" data-copy-home="${escapeHtml(homeName)}" data-copy-away="${escapeHtml(awayName)}" title="複製日期與對戰" aria-label="複製日期與對戰">${copyIcon()}</button></td><td data-sort="${sortableValue(homeName)}" class="player home-player"><div class="player-entry"><span class="player-name">${homeLabel}</span>${rankPill(homeRank, { betterRanked: homeBetter })}</div></td><td data-sort="${sortableValue(awayName)}" class="player away-player"><div class="player-entry"><span class="player-name">${awayLabel}</span>${rankPill(awayRank, { betterRanked: awayBetter })}</div></td><td data-sort="${sortableValue(row?.["熱門方賠率"], true)}" class="num">${odds(row?.["熱門方賠率"])}</td><td data-sort="${sortableValue(row?.["賠轉勝率"], true)}" class="num">${pct(row?.["賠轉勝率"])}</td><td data-sort="${sortableValue(formulaProbability, true)}" class="num"><span class="model-value">${pct(formulaProbability)}</span></td><td data-sort="${sortableValue(formulaEv, true)}" class="num ev">${pct(formulaEv, 2, true)}</td><td data-sort="${sortableValue(({ A: 5, B: 4, C: 3 })[rating] || 0, true)}" class="num rating-cell"><div class="rating-badges"><span class="rating ${ratingClass(rating)} hover rating-trigger" data-template="${rowId}-integrated" data-card-kind="integrated-card" tabindex="0" aria-label="顯示雙方TennisRatio數據與評級勝率計算">${escapeHtml(rating)}</span><span class="d-mini ${dSignalClass}" title="${escapeHtml(dSignalText)}｜D值 ${escapeHtml(numberText(dScore, 3, true))}">${escapeHtml(dCompact)}</span></div></td></tr>`;
    const templatesHtml = `<template id="${rowId}-match">${matchDetail(row)}</template><template id="${rowId}-integrated" data-card-width="${cardWidth}" data-stats-min="${statsMin}">${integratedAnalysis(row)}</template>`;
    return { rowHtml, templatesHtml };
  }

  function ratingCounts(rows) {
    const counts = {
      "全部": rows.length,
      A: 0,
      B: 0,
      C: 0,
      "淘汰": 0,
      "冷門方": 0,
      "過期": 0,
      "資料不足": 0,
      "場地待補": 0,
      "層級待補": 0
    };
    for (const row of rows) {
      const rating = String(row?.["評級"] || "");
      if (rating === "A") counts.A += 1;
      if (rating === "B") counts.B += 1;
      if (rating === "C") counts.C += 1;
      if (rating.includes("淘汰")) counts["淘汰"] += 1;
      if (isColdCandidate(row)) counts["冷門方"] += 1;
      if (rating.includes("過期")) counts["過期"] += 1;
      if (rating === "資料不足") counts["資料不足"] += 1;
      if (rating === "場地待補") counts["場地待補"] += 1;
      if (rating === "層級待補") counts["層級待補"] += 1;
    }
    return counts;
  }

  function renderRows(rows) {
    const rendered = rows.map((row, index) => renderRow(row, index));
    return {
      rowsHtml: rendered.map(item => item.rowHtml).join(""),
      templatesHtml: rendered.map(item => item.templatesHtml).join(""),
      counts: ratingCounts(rows)
    };
  }

  return {
    RAW_METRICS,
    RATING_LABELS,
    escapeHtml,
    pct,
    odds,
    numberText,
    compatibleName,
    rankPill,
    ratingClass,
    dSignalStyle,
    dSignalCompact,
    isColdCandidate,
    matchDetail,
    matchSummary,
    modelDetail,
    bo3PredictionPanel,
    integratedAnalysis,
    renderRow,
    renderRows,
    ratingCounts
  };
});
