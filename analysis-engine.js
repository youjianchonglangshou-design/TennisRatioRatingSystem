(function (root, factory) {
  const utils = typeof module === "object" && module.exports
    ? require("./source-utils.js")
    : root.TennisRatioSourceUtils;
  const api = factory(utils);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TennisRatioAnalysisEngine = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (utils) {
  "use strict";

  if (!utils) throw new Error("source-utils.js 尚未載入。");

  const FORMULA_NAME = "Formula B v1.3";
  const MODEL_ORIENTATION = "pinnacle_lower_odds_hot_first_formula_b";
  const BO3_MODEL_NAME = "BO3 Mechanical v1.0";
  const BO3_MODEL_VERSION = "1.0";
  const APP_VERSION = "4.4.9-strict-five-support-rating";

  const REQUIRED_METRICS = [
    "win_percentage",
    "service_games_won_ratio",
    "return_games_won_ratio",
    "first_serve_points",
    "second_serve_points",
    "return_1st_serve_points",
    "return_2nd_serve_points",
    "breakpoints_saved_ratio",
    "breakpoints_converted_ratio",
    "dominance_ratio",
    "match_eff_ratio"
  ];

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

  const GRADE_ORDER = { 淘汰: 0, C: 1, B: 2, A: 3 };

  class FormulaBError extends Error {
    constructor(message) {
      super(message);
      this.name = "FormulaBError";
    }
  }

  class BO3ModelError extends Error {
    constructor(message) {
      super(message);
      this.name = "BO3ModelError";
    }
  }

  function deepClone(value) {
    if (typeof structuredClone === "function") {
      try { return structuredClone(value); } catch {}
    }
    return JSON.parse(JSON.stringify(value));
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formulaFinite(value, field) {
    const number = finite(value);
    if (number === null) throw new FormulaBError(`${field}缺失或不是數字。`);
    return number;
  }

  function formulaPositive(value, field) {
    const number = formulaFinite(value, field);
    if (number <= 0) throw new FormulaBError(`${field}必須大於0。`);
    return number;
  }

  function clamp(value, lower, upper) {
    return Math.min(upper, Math.max(lower, value));
  }

  function plusFixed(value, digits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
  }

  function percentage0(value) {
    return `${(Number(value) * 100).toFixed(0)}%`;
  }

  function percentage1(value) {
    return `${(Number(value) * 100).toFixed(1)}%`;
  }

  function numberG(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0";
    return Number.isInteger(number) ? String(number) : String(number);
  }

  function jsonClean(value) {
    const hidden = new Set([
      "components_a", "components_b", "樂觀勝率", "樂觀EV",
      "樂觀EV百分比", "樂觀公平賠率", "EV", "EV百分比"
    ]);
    if (Array.isArray(value)) return value.map(jsonClean);
    if (value && typeof value === "object") {
      const output = {};
      for (const [key, item] of Object.entries(value)) {
        if (hidden.has(key)) continue;
        output[key] = jsonClean(item);
      }
      return output;
    }
    if (typeof value === "number" && !Number.isFinite(value)) return null;
    return value;
  }

  function formulaParameters(config) {
    const selected = config?.formula_b && typeof config.formula_b === "object"
      ? config.formula_b
      : {};
    const weights = selected.weights && typeof selected.weights === "object"
      ? selected.weights : {};
    const scales = selected.scales && typeof selected.scales === "object"
      ? selected.scales : {};
    const retention = selected.rank_bad_data_good_retention &&
      typeof selected.rank_bad_data_good_retention === "object"
      ? selected.rank_bad_data_good_retention : {};
    return {
      version: String(selected.version ?? "1.3"),
      base_uplift: Number(selected.base_uplift ?? 0.023),
      adjustment_scale: Number(selected.adjustment_scale ?? 0.031),
      rank_rescue_coefficient: Number(selected.rank_rescue_coefficient ?? 3.8),
      rank_reliability_power: Number(selected.rank_reliability_power ?? 2.5),
      rank_rescue_min_factor: clamp(Number(selected.rank_rescue_min_factor ?? 0.2), 0, 1),
      rank_confirmation_ratio: clamp(Number(selected.rank_confirmation_ratio ?? 0.1), 0, 1),
      rank_confirmation_cap: Math.max(0, Number(selected.rank_confirmation_cap ?? 0.35)),
      rank_bad_data_good_retention: {
        3: clamp(Number(retention["3"] ?? 0.8), 0, 1),
        4: clamp(Number(retention["4"] ?? 0.6), 0, 1),
        5: clamp(Number(retention["5"] ?? 0.4), 0, 1)
      },
      main_sample_full_at: Number(selected.main_sample_full_at ?? 10),
      main_draw_event_factor: clamp(Number(selected.main_draw_event_factor ?? 1), 0, 1),
      main_qualifying_event_factor: clamp(Number(selected.main_qualifying_event_factor ?? 0.5), 0, 1),
      lower_tour_event_factor: clamp(Number(selected.lower_tour_event_factor ?? 0), 0, 1),
      unknown_event_factor: clamp(Number(selected.unknown_event_factor ?? 0), 0, 1),
      minimum_probability: Number(selected.minimum_probability ?? 0.5),
      maximum_probability: Number(selected.maximum_probability ?? 0.8),
      weights: {
        win: Number(weights.win ?? 0.3),
        game: Number(weights.game ?? 0.3),
        point: Number(weights.point ?? 0.15),
        breakpoint: Number(weights.breakpoint ?? 0.1),
        efficiency: Number(weights.efficiency ?? 0.15)
      },
      scales: {
        win: Number(scales.win ?? 10),
        game: Number(scales.game ?? 10),
        point: Number(scales.point ?? 20),
        breakpoint: Number(scales.breakpoint ?? 10)
      }
    };
  }

  function validatedStats(source, label, required) {
    const stats = source && typeof source === "object" ? source : {};
    if (!Object.keys(stats).length && !required) return {};
    const values = {};
    for (const key of ["matches_played", ...REQUIRED_METRICS]) {
      try {
        values[key] = formulaFinite(stats[key], `${label}.${key}`);
      } catch (error) {
        if (!required) return {};
        throw error;
      }
    }
    if (values.matches_played <= 0) {
      if (!required) return {};
      throw new FormulaBError(`${label}.matches_played必須大於0。`);
    }
    for (const key of ["dominance_ratio", "match_eff_ratio"]) {
      if (values[key] <= 0) {
        if (!required) return {};
        throw new FormulaBError(`${label}.${key}必須大於0。`);
      }
    }
    return values;
  }

  function fairMarketProbability(hotOdds, coldOdds) {
    const hot = formulaPositive(hotOdds, "熱門方賠率");
    const cold = formulaPositive(coldOdds, "對手賠率");
    if (hot <= 1 || cold <= 1) throw new FormulaBError("雙方賠率都必須大於1。");
    const hotImplied = 1 / hot;
    const coldImplied = 1 / cold;
    return hotImplied / (hotImplied + coldImplied);
  }

  function eventMainFactor(tournamentLevel, roundName, params) {
    const level = String(tournamentLevel || "").trim();
    const normalizedLevel = level.toLocaleLowerCase("en-US");
    const normalizedRound = String(roundName || "").trim().toLocaleLowerCase("en-US");
    const qualifying = normalizedRound.includes("qualif");
    const lowerTour = ["challenger", "wta 125", "itf", "futures"]
      .some(token => normalizedLevel.includes(token));
    const mainTour = level === "Grand Slam" ||
      new Set(["atp", "wta"]).has(normalizedLevel) ||
      ["atp 250", "atp 500", "atp 1000", "wta 250", "wta 500", "wta 1000"]
        .some(prefix => normalizedLevel.startsWith(prefix)) ||
      normalizedLevel.includes("finals");
    if (lowerTour) {
      return [params.lower_tour_event_factor, `${level || "次級賽事"}以All Levels為主要依據`];
    }
    if (mainTour && qualifying) {
      return [params.main_qualifying_event_factor, `${level || "主巡迴"}資格賽採Main／All折衷`];
    }
    if (mainTour) {
      return [params.main_draw_event_factor, `${level || "主巡迴"}會內賽重視Main Tour`];
    }
    return [params.unknown_event_factor, "賽事層級無法辨認，保守採用All Levels"];
  }

  function mainWeight(mainHot, mainCold, fullAt, tournamentLevel, roundName, params) {
    const [eventFactor, eventReason] = eventMainFactor(tournamentLevel, roundName, params);
    const hotSample = Object.keys(mainHot || {}).length ? Number(mainHot.matches_played || 0) : 0;
    const coldSample = Object.keys(mainCold || {}).length ? Number(mainCold.matches_played || 0) : 0;
    if (hotSample <= 0 || coldSample <= 0) {
      return {
        weight: 0,
        event_factor: eventFactor,
        hot_sample: Math.max(0, hotSample),
        cold_sample: Math.max(0, coldSample),
        effective_sample: 0,
        sample_reliability: 0,
        reason: `${eventReason}；至少一方沒有有效Main Tour樣本`
      };
    }
    const denominator = Math.max(1e-9, Number(fullAt));
    const effectiveSample = 2 * hotSample * coldSample / (hotSample + coldSample);
    const sampleReliability = Math.min(1, effectiveSample / denominator);
    const weight = eventFactor * sampleReliability;
    return {
      weight,
      event_factor: eventFactor,
      hot_sample: hotSample,
      cold_sample: coldSample,
      effective_sample: effectiveSample,
      sample_reliability: sampleReliability,
      reason: `${eventReason}；雙方Main樣本${numberG(hotSample)}／${numberG(coldSample)}場，` +
        `調和有效樣本${effectiveSample.toFixed(2)}場，樣本可信度${percentage1(sampleReliability)}`
    };
  }

  function blend(allStats, mainStats, mainWeightValue) {
    const output = {};
    for (const key of REQUIRED_METRICS) {
      output[key] = mainWeightValue > 0
        ? mainWeightValue * mainStats[key] + (1 - mainWeightValue) * allStats[key]
        : allStats[key];
    }
    return output;
  }

  function rankScenario(rawRankSignal, hotBetterCount, componentCount, params) {
    const count = Math.max(0, Math.min(componentCount, Math.trunc(hotBetterCount)));
    const supportRatio = componentCount ? count / componentCount : 0;
    const rankGood = rawRankSignal > 0;
    const rankBad = rawRankSignal < 0;
    const dataGood = count >= 3;
    if (rankGood && !dataGood) {
      const factor = params.rank_rescue_min_factor +
        (1 - params.rank_rescue_min_factor) * supportRatio;
      return {
        code: "rank_good_data_bad",
        label: "排名救援",
        description: `熱門方排名較前，但五項只有${count}/${componentCount}項較好。`,
        action: `只保留${percentage0(factor)}排名優勢作救援；其餘折掉，最後仍由勝率與EV決定是否淘汰。`,
        factor,
        adjustment: rawRankSignal * factor
      };
    }
    if (rankGood && dataGood) {
      const beforeSupport = Math.min(
        rawRankSignal * params.rank_confirmation_ratio,
        params.rank_confirmation_cap
      );
      const adjustment = beforeSupport * supportRatio;
      return {
        code: "rank_good_data_good",
        label: "排名確認",
        description: `熱門方排名較前，五項也有${count}/${componentCount}項較好；數據本身已支持熱門方。`,
        action: `不啟動排名救援，只給小幅排名確認：原始排名訊號的10%，上限0.35，再乘五項支持率${percentage0(supportRatio)}。`,
        factor: rawRankSignal ? adjustment / rawRankSignal : 0,
        adjustment
      };
    }
    if (rankBad && !dataGood) {
      return {
        code: "rank_bad_data_bad",
        label: "放棄區",
        description: `熱門方排名較後，五項也只有${count}/${componentCount}項較好。`,
        action: "不救援，完整保留排名負向扣分；若修正後EV不大於0，即真正淘汰。",
        factor: 1,
        adjustment: rawRankSignal
      };
    }
    if (rankBad && dataGood) {
      const retention = params.rank_bad_data_good_retention[count] ?? 0.4;
      return {
        code: "rank_bad_data_good",
        label: "數據逆排名",
        description: `熱門方排名較後，但五項有${count}/${componentCount}項較好。`,
        action: `讓數據抵銷部分排名疑慮，只保留${percentage0(retention)}排名負向扣分，最後由EV決定。`,
        factor: retention,
        adjustment: rawRankSignal * retention
      };
    }
    return {
      code: dataGood ? "rank_tied_data_good" : "rank_tied_data_bad",
      label: "排名相同",
      description: `雙方排名相同；熱門方五項有${count}/${componentCount}項較好。`,
      action: "排名不加分也不扣分，只使用雙方數據與市場基準。",
      factor: 0,
      adjustment: 0
    };
  }

  function calculateFormulaB(options) {
    const params = formulaParameters(options.config || {});
    const hotRank = formulaPositive(options.hotRank, "熱門方排名");
    const coldRank = formulaPositive(options.coldRank, "對手排名");
    const allHot = validatedStats(options.allStatsHot, "All熱門方", true);
    const allCold = validatedStats(options.allStatsCold, "All對手", true);
    const mainHot = validatedStats(options.mainStatsHot, "Main熱門方", false);
    const mainCold = validatedStats(options.mainStatsCold, "Main對手", false);
    const mix = mainWeight(
      mainHot, mainCold, params.main_sample_full_at,
      options.tournamentLevel, options.roundName, params
    );
    const mainWeightValue = Number(mix.weight);
    const blendedHot = blend(allHot, mainHot, mainWeightValue);
    const blendedCold = blend(allCold, mainCold, mainWeightValue);
    const weights = params.weights;
    const scales = params.scales;

    const winHot = blendedHot.win_percentage;
    const winCold = blendedCold.win_percentage;
    const winDiff = winHot - winCold;
    const winContribution = weights.win * winDiff / scales.win;

    const gameHot = blendedHot.service_games_won_ratio + blendedHot.return_games_won_ratio;
    const gameCold = blendedCold.service_games_won_ratio + blendedCold.return_games_won_ratio;
    const gameDiff = gameHot - gameCold;
    const gameContribution = weights.game * gameDiff / scales.game;

    const pointKeys = [
      "first_serve_points", "second_serve_points",
      "return_1st_serve_points", "return_2nd_serve_points"
    ];
    const pointHot = pointKeys.reduce((sum, key) => sum + blendedHot[key], 0);
    const pointCold = pointKeys.reduce((sum, key) => sum + blendedCold[key], 0);
    const pointDiff = pointHot - pointCold;
    const pointContribution = weights.point * pointDiff / scales.point;

    const breakpointHot = blendedHot.breakpoints_saved_ratio + blendedHot.breakpoints_converted_ratio;
    const breakpointCold = blendedCold.breakpoints_saved_ratio + blendedCold.breakpoints_converted_ratio;
    const breakpointDiff = breakpointHot - breakpointCold;
    const breakpointContribution = weights.breakpoint * breakpointDiff / scales.breakpoint;

    const efficiencyHot = blendedHot.dominance_ratio * blendedHot.match_eff_ratio;
    const efficiencyCold = blendedCold.dominance_ratio * blendedCold.match_eff_ratio;
    const efficiencyLogRatio = Math.log(efficiencyHot / efficiencyCold);
    const efficiencyContribution = weights.efficiency * efficiencyLogRatio;

    const componentRows = [
      { key: "win", label: "勝率差", 熱門方值: winHot, 對手值: winCold, 差值: winDiff, 權重: weights.win, 縮放: scales.win, 貢獻: winContribution, value_format: "percentage" },
      { key: "game", label: "保發＋接發局", 熱門方值: gameHot, 對手值: gameCold, 差值: gameDiff, 權重: weights.game, 縮放: scales.game, 貢獻: gameContribution, value_format: "percentage_sum" },
      { key: "point", label: "發接得分合計", 熱門方值: pointHot, 對手值: pointCold, 差值: pointDiff, 權重: weights.point, 縮放: scales.point, 貢獻: pointContribution, value_format: "percentage_sum" },
      { key: "breakpoint", label: "破發點挽救＋轉換", 熱門方值: breakpointHot, 對手值: breakpointCold, 差值: breakpointDiff, 權重: weights.breakpoint, 縮放: scales.breakpoint, 貢獻: breakpointContribution, value_format: "percentage_sum" },
      { key: "efficiency", label: "Dominance×Match Efficiency", 熱門方值: efficiencyHot, 對手值: efficiencyCold, 差值: efficiencyLogRatio, 權重: weights.efficiency, 縮放: null, 貢獻: efficiencyContribution, value_format: "ratio" }
    ];

    const dataScore = componentRows.reduce((sum, row) => sum + Number(row.貢獻), 0);
    const rankLogGap = Math.log(coldRank / hotRank);
    const rankReliability = 50 / (50 + Math.min(hotRank, coldRank));
    const rawRankSignal = params.rank_rescue_coefficient *
      Math.pow(rankReliability, params.rank_reliability_power) * rankLogGap;
    const componentCount = componentRows.length;
    const hotBetterComponentCount = componentRows.filter(row => Number(row.差值) > 0).length;
    const scenario = rankScenario(rawRankSignal, hotBetterComponentCount, componentCount, params);
    const signal = dataScore + scenario.adjustment;
    const tanhSignal = Math.tanh(signal);
    const dataRankAdjustment = params.adjustment_scale * tanhSignal;
    const fairProbability = fairMarketProbability(options.hotOdds, options.coldOdds);
    const hotBreakEven = 1 / formulaPositive(options.hotOdds, "熱門方賠率");
    const unbounded = fairProbability + params.base_uplift + dataRankAdjustment;
    const probability = clamp(unbounded, params.minimum_probability, params.maximum_probability);

    return {
      probability,
      fair_market_probability: fairProbability,
      hot_break_even_probability: hotBreakEven,
      main_weight: mainWeightValue,
      all_levels_weight: 1 - mainWeightValue,
      tournament_level: String(options.tournamentLevel || ""),
      round_name: String(options.roundName || ""),
      event_main_factor: Number(mix.event_factor),
      main_hot_sample: Number(mix.hot_sample),
      main_cold_sample: Number(mix.cold_sample),
      main_effective_sample: Number(mix.effective_sample),
      main_sample_reliability: Number(mix.sample_reliability),
      main_weight_reason: String(mix.reason),
      data_score: dataScore,
      rank_log_gap: rankLogGap,
      rank_reliability: rankReliability,
      raw_rank_signal: rawRankSignal,
      rank_scenario_code: String(scenario.code),
      rank_scenario: String(scenario.label),
      rank_scenario_description: String(scenario.description),
      rank_scenario_action: String(scenario.action),
      rank_effect_factor: Number(scenario.factor),
      rank_adjustment: Number(scenario.adjustment),
      raw_rank_rescue: rawRankSignal,
      rank_rescue_factor: Number(scenario.factor),
      hot_better_component_count: hotBetterComponentCount,
      component_count: componentCount,
      rank_rescue: Number(scenario.adjustment),
      signal,
      tanh_signal: tanhSignal,
      base_uplift: params.base_uplift,
      data_rank_adjustment: dataRankAdjustment,
      minimum_probability: params.minimum_probability,
      maximum_probability: params.maximum_probability,
      signal_label: String(scenario.label),
      blended_hot: blendedHot,
      blended_cold: blendedCold,
      component_rows: componentRows,
      parameters: params
    };
  }

  function comparisonStats(player, scope) {
    const source = player?.[scope] && typeof player[scope] === "object" ? player[scope] : {};
    return source.stats && typeof source.stats === "object" ? source.stats : {};
  }

  function otherPosition(position) {
    return position === "主場" ? "客場" : position === "客場" ? "主場" : null;
  }

  function comparisonRole(position, hotPosition) {
    if (!new Set(["主場", "客場"]).has(position)) return null;
    if (position === hotPosition) return "熱門方";
    if (position === otherPosition(hotPosition)) return "對手";
    return null;
  }

  function comparisonWinner(homeValue, awayValue, lowerIsBetter) {
    if (homeValue === null || awayValue === null || homeValue === awayValue) return null;
    if (lowerIsBetter) return homeValue < awayValue ? "主場" : "客場";
    return homeValue > awayValue ? "主場" : "客場";
  }

  function comparisonSample(stats) {
    const played = finite(stats.matches_played);
    const won = finite(stats.matches_won);
    const lost = finite(stats.matches_lost);
    return {
      比賽數: played === null ? null : Math.trunc(played),
      勝: won === null ? null : Math.trunc(won),
      敗: lost === null ? null : Math.trunc(lost),
      顯示: won !== null && lost !== null ? `${Math.trunc(won)}-${Math.trunc(lost)}` : "—"
    };
  }

  function rawItem(spec, homeStats, awayStats, homeName, awayName, hotPosition) {
    const homeValue = finite(homeStats[spec.key]);
    const awayValue = finite(awayStats[spec.key]);
    const winnerPosition = comparisonWinner(homeValue, awayValue, Boolean(spec.lower_is_better));
    const missing = homeValue === null || awayValue === null;
    let betterRole, winnerName, reading;
    if (missing) {
      betterRole = "資料不足"; winnerName = null; reading = "資料不足";
    } else if (winnerPosition === null) {
      betterRole = "相同"; winnerName = null; reading = "雙方相同";
    } else {
      betterRole = comparisonRole(winnerPosition, hotPosition) || winnerPosition;
      winnerName = winnerPosition === "主場" ? homeName : awayName;
      reading = `${winnerName}較好（${betterRole}）`;
    }
    return {
      key: String(spec.key),
      名稱: spec.label,
      主場值: homeValue,
      客場值: awayValue,
      差值: homeValue !== null && awayValue !== null ? homeValue - awayValue : null,
      value_format: spec.value_format,
      判定方向: spec.lower_is_better ? "數值越低越好" : "數值越高越好",
      較優位置: winnerPosition,
      較優方: betterRole,
      較優選手: winnerName,
      判讀: reading
    };
  }

  function rawSummary(items, homeName, awayName, hotPosition) {
    const homeCount = items.filter(item => item.較優位置 === "主場").length;
    const awayCount = items.filter(item => item.較優位置 === "客場").length;
    const tieCount = items.filter(item => item.較優方 === "相同").length;
    const missingCount = items.filter(item => item.較優方 === "資料不足").length;
    const validCount = items.length - missingCount;
    const hotCount = hotPosition === "主場" ? homeCount : hotPosition === "客場" ? awayCount : 0;
    const coldCount = hotPosition === "主場" ? awayCount : hotPosition === "客場" ? homeCount : 0;
    let winnerPosition, betterRole, winnerName, reading;
    if (validCount === 0) {
      winnerPosition = null; betterRole = "資料不足"; winnerName = null; reading = "沒有足夠資料可比較";
    } else if (homeCount === awayCount) {
      winnerPosition = null; betterRole = "相同"; winnerName = null;
      reading = `雙方較優項目數相同（${homeCount}比${awayCount}）`;
    } else {
      winnerPosition = homeCount > awayCount ? "主場" : "客場";
      betterRole = comparisonRole(winnerPosition, hotPosition) || winnerPosition;
      winnerName = winnerPosition === "主場" ? homeName : awayName;
      reading = `${winnerName}較優項目較多（${Math.max(homeCount, awayCount)}比${Math.min(homeCount, awayCount)}，${betterRole}）`;
    }
    return {
      總項目數: items.length,
      有效比較項數: validCount,
      主場較優項數: homeCount,
      客場較優項數: awayCount,
      熱門方較優項數: hotCount,
      對手較優項數: coldCount,
      平手項數: tieCount,
      資料不足項數: missingCount,
      統計較優位置: winnerPosition,
      統計較優方: betterRole,
      統計較優選手: winnerName,
      判讀: reading
    };
  }

  function rawScope(scope, displayName, homePlayer, awayPlayer, homeName, awayName, hotPosition) {
    const homeStats = comparisonStats(homePlayer, scope);
    const awayStats = comparisonStats(awayPlayer, scope);
    const items = RAW_METRICS.map(spec => rawItem(
      spec, homeStats, awayStats, homeName, awayName, hotPosition
    ));
    return {
      名稱: displayName,
      主場球員: homeName,
      客場球員: awayName,
      樣本: {
        主場: comparisonSample(homeStats),
        客場: comparisonSample(awayStats),
        是否列入統計: false
      },
      統計: rawSummary(items, homeName, awayName, hotPosition),
      項目: items
    };
  }

  function buildRawComparisons(result, homePlayer, awayPlayer) {
    const homeName = String(homePlayer?.正式姓名 || result.主場 || "主場球員");
    const awayName = String(awayPlayer?.正式姓名 || result.客場 || "客場球員");
    const hotPosition = String(result.熱門方位置 || "") || null;
    return {
      版本: "1.0",
      計分說明: "勝率與下方14項指標列入統計；樣本不計分。雙誤／場為數值越低越好，其餘為數值越高越好；平手不加分。",
      熱門方: result.熱門方,
      熱門方位置: hotPosition,
      "All Levels｜同場地": rawScope(
        "all_surface", "All Levels｜同場地",
        homePlayer, awayPlayer, homeName, awayName, hotPosition
      ),
      "Main Tour｜同場地": rawScope(
        "main_surface", "Main Tour｜同場地",
        homePlayer, awayPlayer, homeName, awayName, hotPosition
      )
    };
  }

  function buildRatingComparison(componentRows, hotName, coldName, hotPosition) {
    const items = [];
    for (const source of Array.isArray(componentRows) ? componentRows : []) {
      if (!source || typeof source !== "object") continue;
      const difference = finite(source.差值);
      const hotValue = finite(source.熱門方值);
      const coldValue = finite(source.對手值);
      let betterRole, betterName, betterPosition, reading;
      if (difference === null || hotValue === null || coldValue === null) {
        betterRole = "資料不足"; betterName = null; betterPosition = null; reading = "資料不足";
      } else if (difference > 0) {
        betterRole = "熱門方"; betterName = hotName; betterPosition = hotPosition; reading = "熱門方較好";
      } else if (difference < 0) {
        betterRole = "對手"; betterName = coldName; betterPosition = otherPosition(hotPosition); reading = "對手較好";
      } else {
        betterRole = "相同"; betterName = null; betterPosition = null; reading = "雙方相同";
      }
      const key = String(source.key || "");
      items.push({
        key,
        名稱: RATING_LABELS[key] || String(source.label || key || "—"),
        原始名稱: source.label,
        熱門方值: hotValue,
        對手值: coldValue,
        差值: difference,
        value_format: source.value_format,
        判定方向: "數值越高越好",
        較優位置: betterPosition,
        較優方: betterRole,
        較優選手: betterName,
        判讀: reading,
        權重: finite(source.權重),
        貢獻: finite(source.貢獻)
      });
    }
    const hotCount = items.filter(item => item.較優方 === "熱門方").length;
    const coldCount = items.filter(item => item.較優方 === "對手").length;
    const tieCount = items.filter(item => item.較優方 === "相同").length;
    const missingCount = items.filter(item => item.較優方 === "資料不足").length;
    const validCount = items.length - missingCount;
    let betterRole, betterName, reading;
    if (validCount === 0) {
      betterRole = "資料不足"; betterName = null; reading = "沒有足夠資料可比較";
    } else if (hotCount === coldCount) {
      betterRole = "相同"; betterName = null;
      reading = `雙方較優項目數相同（${hotCount}比${coldCount}）`;
    } else if (hotCount > coldCount) {
      betterRole = "熱門方"; betterName = hotName;
      reading = `熱門方較優項目較多（${hotCount}比${coldCount}）`;
    } else {
      betterRole = "對手"; betterName = coldName;
      reading = `對手較優項目較多（${coldCount}比${hotCount}）`;
    }
    return {
      版本: "1.0",
      資料基準: "評級公式使用的All Levels與Main Tour混合數據",
      熱門方: hotName,
      對手: coldName,
      熱門方位置: hotPosition,
      統計: {
        總項目數: items.length,
        有效比較項數: validCount,
        熱門方較優項數: hotCount,
        對手較優項數: coldCount,
        平手項數: tieCount,
        資料不足項數: missingCount,
        統計較優方: betterRole,
        統計較優選手: betterName,
        判讀: reading
      },
      項目: items
    };
  }

  function bo3Finite(value, label) {
    const number = finite(value);
    if (number === null) throw new BO3ModelError(`${label}缺失或不是數字。`);
    return number;
  }

  function bo3Probability(value, label) {
    const number = bo3Finite(value, label);
    if (!(number > 0 && number < 1)) throw new BO3ModelError(`${label}必須介於0與1之間。`);
    return number;
  }

  function bo3Percentage(stats, key, label) {
    const number = bo3Finite(stats?.[key], `${label}.${key}`) / 100;
    if (!(number > 0 && number < 1)) throw new BO3ModelError(`${label}.${key}必須介於0%與100%之間。`);
    return number;
  }

  function bo3Clamp(value, lower = 0.001, upper = 0.999) {
    return clamp(value, lower, upper);
  }

  function bo3Logit(value) {
    const selected = bo3Clamp(value);
    return Math.log(selected / (1 - selected));
  }

  function bo3Logistic(value) {
    if (value >= 0) {
      const inverse = Math.exp(-value);
      return 1 / (1 + inverse);
    }
    const forward = Math.exp(value);
    return forward / (1 + forward);
  }

  function combination(n, k) {
    if (k < 0 || k > n) return 0;
    let result = 1;
    const m = Math.min(k, n - k);
    for (let i = 1; i <= m; i += 1) result = result * (n - m + i) / i;
    return result;
  }

  function holdFromPoint(pointProbability) {
    const point = bo3Clamp(pointProbability);
    const lost = 1 - point;
    const beforeDeuce = Math.pow(point, 4) * (1 + 4 * lost + 10 * Math.pow(lost, 2));
    const reachDeuce = 20 * Math.pow(point, 3) * Math.pow(lost, 3);
    const winFromDeuce = Math.pow(point, 2) / (Math.pow(point, 2) + Math.pow(lost, 2));
    return beforeDeuce + reachDeuce * winFromDeuce;
  }

  function pointFromHold(holdProbability) {
    const target = bo3Clamp(holdProbability);
    let lower = 0.01, upper = 0.99;
    for (let i = 0; i < 60; i += 1) {
      const middle = (lower + upper) / 2;
      if (holdFromPoint(middle) < target) lower = middle;
      else upper = middle;
    }
    return (lower + upper) / 2;
  }

  function tiebreakWin(pointProbability) {
    const point = bo3Clamp(pointProbability);
    const lost = 1 - point;
    let winBeforeSixAll = 0;
    for (let losingPoints = 0; losingPoints < 6; losingPoints += 1) {
      winBeforeSixAll += combination(6 + losingPoints, losingPoints) *
        Math.pow(point, 7) * Math.pow(lost, losingPoints);
    }
    const reachSixAll = combination(12, 6) * Math.pow(point, 6) * Math.pow(lost, 6);
    const winFromSixAll = Math.pow(point, 2) / (Math.pow(point, 2) + Math.pow(lost, 2));
    return winBeforeSixAll + reachSixAll * winFromSixAll;
  }

  function setDistribution(hotHold, coldHold) {
    const selectedHotHold = bo3Clamp(hotHold);
    const selectedColdHold = bo3Clamp(coldHold);
    const hotServePoint = pointFromHold(selectedHotHold);
    const coldServePoint = pointFromHold(selectedColdHold);
    const equivalentPoint = (hotServePoint + (1 - coldServePoint)) / 2;
    const hotTiebreak = tiebreakWin(equivalentPoint);
    const distribution = new Map();

    function add(h, c, value) {
      const key = `${h},${c}`;
      distribution.set(key, (distribution.get(key) || 0) + value);
    }

    function walk(hotGames, coldGames, server, pathProbability) {
      if (hotGames === 6 && coldGames === 6) {
        add(7, 6, pathProbability * hotTiebreak);
        add(6, 7, pathProbability * (1 - hotTiebreak));
        return;
      }
      if ((hotGames >= 6 || coldGames >= 6) && Math.abs(hotGames - coldGames) >= 2) {
        add(hotGames, coldGames, pathProbability);
        return;
      }
      const hotGameProbability = server === "hot" ? selectedHotHold : 1 - selectedColdHold;
      const nextServer = server === "hot" ? "cold" : "hot";
      walk(hotGames + 1, coldGames, nextServer, pathProbability * hotGameProbability);
      walk(hotGames, coldGames + 1, nextServer, pathProbability * (1 - hotGameProbability));
    }

    walk(0, 0, "hot", 0.5);
    walk(0, 0, "cold", 0.5);
    let hotSetProbability = 0;
    for (const [key, probability] of distribution.entries()) {
      const [h, c] = key.split(",").map(Number);
      if (h > c) hotSetProbability += probability;
    }
    return {
      distribution,
      hot_hold: selectedHotHold,
      cold_hold: selectedColdHold,
      hot_tiebreak: hotTiebreak,
      hot_set_probability: hotSetProbability
    };
  }

  function matchProbability(setProbability) {
    const value = bo3Clamp(setProbability);
    return 3 * Math.pow(value, 2) - 2 * Math.pow(value, 3);
  }

  function setProbabilityFromMatch(matchProbabilityValue) {
    const target = bo3Probability(matchProbabilityValue, "評級勝率");
    let lower = 0.001, upper = 0.999;
    for (let i = 0; i < 70; i += 1) {
      const middle = (lower + upper) / 2;
      if (matchProbability(middle) < target) lower = middle;
      else upper = middle;
    }
    return (lower + upper) / 2;
  }

  function calibratedSetModel(targetSetProbability, baseHotHold, baseHotBreak) {
    let lower = -8, upper = 8;
    let selected = setDistribution(baseHotHold, 1 - baseHotBreak);
    for (let i = 0; i < 70; i += 1) {
      const shift = (lower + upper) / 2;
      const hotHold = bo3Logistic(bo3Logit(baseHotHold) + shift);
      const hotBreak = bo3Logistic(bo3Logit(baseHotBreak) + shift);
      selected = setDistribution(hotHold, 1 - hotBreak);
      if (selected.hot_set_probability < targetSetProbability) lower = shift;
      else upper = shift;
    }
    const finalShift = (lower + upper) / 2;
    const hotHold = bo3Logistic(bo3Logit(baseHotHold) + finalShift);
    const hotBreak = bo3Logistic(bo3Logit(baseHotBreak) + finalShift);
    return [setDistribution(hotHold, 1 - hotBreak), finalShift];
  }

  function calculateBO3Prediction(options) {
    const probability = bo3Probability(options.matchProbability, "評級勝率");
    const hotStats = options.blendedHot && typeof options.blendedHot === "object" ? options.blendedHot : {};
    const coldStats = options.blendedCold && typeof options.blendedCold === "object" ? options.blendedCold : {};
    const hotHoldHistory = bo3Percentage(hotStats, "service_games_won_ratio", "熱門方混合數據");
    const hotBreakHistory = bo3Percentage(hotStats, "return_games_won_ratio", "熱門方混合數據");
    const coldHoldHistory = bo3Percentage(coldStats, "service_games_won_ratio", "對手混合數據");
    const coldBreakHistory = bo3Percentage(coldStats, "return_games_won_ratio", "對手混合數據");
    const baseHotHold = (hotHoldHistory + (1 - coldBreakHistory)) / 2;
    const baseHotBreak = (hotBreakHistory + (1 - coldHoldHistory)) / 2;
    const targetSetProbability = setProbabilityFromMatch(probability);
    const [setModel, strengthShift] = calibratedSetModel(targetSetProbability, baseHotHold, baseHotBreak);
    const setProbability = setModel.hot_set_probability;
    const coldSetProbability = 1 - setProbability;
    const hotTwoZero = Math.pow(setProbability, 2);
    const hotTwoOne = 2 * Math.pow(setProbability, 2) * coldSetProbability;
    const coldTwoOne = 2 * setProbability * Math.pow(coldSetProbability, 2);
    const coldTwoZero = Math.pow(coldSetProbability, 2);
    const twoSets = hotTwoZero + coldTwoZero;
    const threeSets = hotTwoOne + coldTwoOne;
    let tiebreakSet = 0;
    let expectedSetGames = 0;
    const singleSetRows = [];
    for (const [key, value] of setModel.distribution.entries()) {
      const [hotGames, coldGames] = key.split(",").map(Number);
      if ((hotGames === 7 && coldGames === 6) || (hotGames === 6 && coldGames === 7)) {
        tiebreakSet += value;
      }
      expectedSetGames += (hotGames + coldGames) * value;
      singleSetRows.push({
        熱門方局數: hotGames,
        對手局數: coldGames,
        熱門方比分: `${hotGames}–${coldGames}`,
        對手比分: `${coldGames}–${hotGames}`,
        機率: value
      });
    }
    singleSetRows.sort((a, b) => b.機率 - a.機率);
    const expectedMatchGames = expectedSetGames * (2 + threeSets);
    const hotName = String(options.hotName || "—");
    const coldName = String(options.coldName || "—");
    return {
      名稱: BO3_MODEL_NAME,
      版本: BO3_MODEL_VERSION,
      狀態: "complete",
      賽制: "BO3",
      熱門方球員: hotName,
      對手球員: coldName,
      評級勝率: probability,
      熱門方單盤勝率: setProbability,
      對手單盤勝率: coldSetProbability,
      兩盤機率: twoSets,
      三盤機率: threeSets,
      單盤搶七機率: tiebreakSet,
      預估總局數: expectedMatchGames,
      盤數機率: {
        熱門方2比0: hotTwoZero,
        熱門方2比1: hotTwoOne,
        對手2比1: coldTwoOne,
        對手2比0: coldTwoZero
      },
      熱門方預測: {
        角色: "熱門方", 球員: hotName, 總勝率: probability,
        "2比0機率": hotTwoZero, "2比1機率": hotTwoOne
      },
      對手預測: {
        角色: "對手", 球員: coldName, 總勝率: 1 - probability,
        "2比0機率": coldTwoZero, "2比1機率": coldTwoOne
      },
      單盤比分分布: singleSetRows,
      計算輸入: {
        熱門方歷史保發率: hotHoldHistory,
        熱門方歷史破發率: hotBreakHistory,
        對手歷史保發率: coldHoldHistory,
        對手歷史破發率: coldBreakHistory,
        交叉後熱門方基礎保發率: baseHotHold,
        交叉後熱門方基礎破發率: baseHotBreak,
        強弱校準值: strengthShift,
        校準後熱門方保發率: setModel.hot_hold,
        校準後對手保發率: setModel.cold_hold,
        搶七熱門方勝率: setModel.hot_tiebreak
      }
    };
  }

  function preliminaryElimination(row, config) {
    const eligibility = config?.eligibility || {};
    const league = String(row?.聯賽 || "");
    const normalized = league.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
    const words = normalized.split(/\s+/);
    const home = String(row?.主場 || "");
    const away = String(row?.客場 || "");
    if ((eligibility.eliminate_doubles ?? true) &&
      (words.includes("doubles") || (home.includes("/") && away.includes("/")))) {
      return "雙打比賽依規則淘汰。";
    }
    if ((eligibility.eliminate_itf_futures ?? true) &&
      (words.includes("itf") || words.includes("futures"))) {
      return "ITF／Futures依規則淘汰。";
    }
    return null;
  }

  function evGrade(evPct, thresholds) {
    if (evPct >= Number(thresholds.A_ev_min_pct ?? 7)) return "A";
    if (evPct >= Number(thresholds.B_ev_min_pct ?? 4)) return "B";
    if (evPct > Number(thresholds.C_ev_min_pct ?? 0)) return "C";
    return "淘汰";
  }

  function supportCeiling(count, thresholds) {
    if (count >= Number(thresholds.A_support_min ?? 5)) return "A";
    if (count >= Number(thresholds.B_support_min ?? 4)) return "B";
    if (count >= Number(thresholds.C_support_min ?? 3)) return "C";
    return "淘汰";
  }

  function ratingDecision(options) {
    const thresholds = options.config?.rating || {};
    const probabilityPct = options.probability * 100;
    const evGradeValue = evGrade(options.evPct, thresholds);
    const supportCeilingValue = supportCeiling(options.hotSupportCount, thresholds);
    const finalGrade = GRADE_ORDER[evGradeValue] <= GRADE_ORDER[supportCeilingValue]
      ? evGradeValue : supportCeilingValue;
    const reasons = [];
    if (evGradeValue === finalGrade && finalGrade !== "A") {
      const nextThreshold = evGradeValue === "淘汰"
        ? thresholds.C_ev_min_pct ?? 0
        : evGradeValue === "C"
          ? thresholds.B_ev_min_pct ?? 4
          : thresholds.A_ev_min_pct ?? 7;
      const comparator = evGradeValue === "淘汰" ? "大於" : "至少";
      reasons.push(`評級EV${plusFixed(options.evPct, 2)}%僅達${evGradeValue}（下一級需${comparator}${Number(nextThreshold).toFixed(0)}%）`);
    }
    if (supportCeilingValue === finalGrade && finalGrade !== "A") {
      reasons.push(`五項支持${options.hotSupportCount}/${options.componentCount}，評級最高只能${supportCeilingValue}`);
    }
    return {
      最終評級: finalGrade,
      評級勝率參考: probabilityPct,
      評級勝率是否參與門檻: false,
      評級EV等級: evGradeValue,
      五項支持上限: supportCeilingValue,
      熱門方五項支持: options.hotSupportCount,
      五項比較數: options.componentCount,
      降級原因: reasons,
      門檻: {
        A: { 評級EV至少: Number(thresholds.A_ev_min_pct ?? 7), 五項支持等於: Number(thresholds.A_support_min ?? 5) },
        B: { 評級EV至少: Number(thresholds.B_ev_min_pct ?? 4), 五項支持至少: Number(thresholds.B_support_min ?? 4) },
        C: { 評級EV大於: Number(thresholds.C_ev_min_pct ?? 0), 五項支持至少: Number(thresholds.C_support_min ?? 3) }
      }
    };
  }

  function favorite(row) {
    const homeName = String(row?.主場 || "").trim();
    const awayName = String(row?.客場 || "").trim();
    const homeOdds = finite(row?.主場賠率);
    const awayOdds = finite(row?.客場賠率);
    if (!homeName || !awayName || homeOdds === null || awayOdds === null ||
      homeOdds <= 1 || awayOdds <= 1 || Math.abs(homeOdds - awayOdds) < 1e-12) {
      return { name: null, position: null, odds: null, break_even_probability: null };
    }
    const homeHot = homeOdds < awayOdds;
    const odds = homeHot ? homeOdds : awayOdds;
    return {
      name: homeHot ? homeName : awayName,
      position: homeHot ? "主場" : "客場",
      odds,
      break_even_probability: 1 / odds
    };
  }

  function expired(row, now = new Date(), minutes = 15) {
    const start = utils.parseTaipeiDateTime(row?.日期時間);
    if (!start) return false;
    return now.getTime() >= start.getTime() + minutes * 60000;
  }

  function addUiAliases(row) {
    const output = deepClone(row);
    output.評級勝率 = output.公式B勝率;
    output.評級公平賠率 = output.公式B公平賠率;
    output.評級EV = output["公式B EV"];
    output.評級EV百分比 = output["公式B EV百分比"];
    return output;
  }

  function baseResult(row, now) {
    const hot = favorite(row);
    const isExpired = expired(row, now);
    const info = row?.Pinnacle比賽資訊 && typeof row.Pinnacle比賽資訊 === "object"
      ? deepClone(row.Pinnacle比賽資訊)
      : utils.matchInfo(row);
    return addUiAliases({
      項次: row?.項次 ?? null,
      日期時間: row?.日期時間 ?? null,
      聯賽: row?.聯賽 ?? null,
      主場: row?.主場 ?? null,
      客場: row?.客場 ?? null,
      主場名次: null,
      客場名次: null,
      主場賠率: row?.主場賠率 ?? null,
      客場賠率: row?.客場賠率 ?? null,
      熱門方: hot.name,
      熱門方位置: hot.position,
      熱門方賠率: hot.odds,
      hot: hot.break_even_probability,
      賠轉勝率: hot.break_even_probability,
      Pinnacle去水勝率: null,
      公式B勝率: null,
      評級勝率: null,
      公式B公平賠率: null,
      評級公平賠率: null,
      "公式B EV": null,
      "公式B EV百分比": null,
      評級EV: null,
      評級EV百分比: null,
      公式B狀態: null,
      評級: "尚未分析",
      判定原因: [],
      分析狀態: "pending",
      已過期: isExpired,
      時效狀態: isExpired ? "過期" : "未過期",
      比賽資訊: row?.比賽資訊 && typeof row.比賽資訊 === "object"
        ? deepClone(row.比賽資訊) : deepClone(info),
      Pinnacle比賽資訊: info,
      "365Scores": deepClone(row?.["365Scores"] || {}),
      TennisRatio賽事場地: deepClone(row?.TennisRatio賽事場地 || {}),
      TennisRatio: deepClone(row?.TennisRatio || {}),
      原始指標比較: {},
      評級五項比較: {},
      評級判定: {},
      BO3機械預測: {},
      模型: {}
    });
  }

  function ratingPlayerStats(player, key) {
    const source = player?.[key] && typeof player[key] === "object" ? player[key] : {};
    return source.stats && typeof source.stats === "object" ? { ...source.stats } : {};
  }

  function selectHotCold(result, homePlayer, awayPlayer) {
    if (result.熱門方位置 === "主場") return [homePlayer, awayPlayer];
    if (result.熱門方位置 === "客場") return [awayPlayer, homePlayer];
    throw new Error("Pinnacle主客賠率無法定義熱門方。");
  }

  function coldOdds(result) {
    if (result.熱門方位置 === "主場") return result.客場賠率;
    if (result.熱門方位置 === "客場") return result.主場賠率;
    return null;
  }

  function applyExpiry(result) {
    if (!result.已過期) return result;
    const rating = String(result.評級 || "");
    const status = String(result.分析狀態 || "");
    if (rating === "淘汰") {
      result.評級 = "淘汰＋過期";
      result.分析狀態 = "eliminated_and_expired";
    } else if (["資料不足", "尚未分析"].includes(rating) ||
      ["player_not_found", "surface_sample_missing", "formula_b_unavailable"].includes(status)) {
      result.評級 = "過期";
      result.分析狀態 = "expired";
    }
    const reasons = Array.isArray(result.判定原因) ? result.判定原因 : [];
    const note = "此場已超過Pinnacle開賽時間；過期不停止TennisRatio資料補抓。";
    if (!reasons.includes(note)) reasons.push(note);
    result.判定原因 = reasons;
    return result;
  }

  function evaluate(result, homePlayer, awayPlayer, config) {
    result.原始指標比較 = buildRawComparisons(result, homePlayer, awayPlayer);
    result.評級五項比較 = {};
    if (result.熱門方 === null) {
      Object.assign(result, { 評級: "資料不足", 分析狀態: "odds_invalid", 判定原因: ["Pinnacle賠率缺失、相同或格式異常。"] });
      return addUiAliases(result);
    }
    const elimination = preliminaryElimination(result, config);
    if (elimination) {
      Object.assign(result, {
        評級: result.已過期 ? "淘汰＋過期" : "淘汰",
        分析狀態: "hard_eliminated",
        判定原因: [elimination]
      });
      return addUiAliases(jsonClean(result));
    }
    const matchDetails = result.比賽資訊 && typeof result.比賽資訊 === "object" ? result.比賽資訊 : {};
    if (!matchDetails.tournament_level) {
      Object.assign(result, {
        評級: "層級待補",
        分析狀態: "tournament_level_missing",
        判定原因: ["Pinnacle賽事層級無法辨認，為避免錯配Main／All而不評級。"]
      });
      return addUiAliases(jsonClean(result));
    }
    const ratio = result.TennisRatio && typeof result.TennisRatio === "object" ? result.TennisRatio : {};
    const surface = String(ratio.場地 || "");
    const surfaceKey = surface.toLocaleLowerCase("en-US");
    const foundCount = Number(Boolean(homePlayer?.found)) + Number(Boolean(awayPlayer?.found));
    result.個別球員資料 = {
      found_count: foundCount,
      total: 2,
      status: foundCount === 2 ? "complete" : foundCount === 1 ? "partial" : "not_found"
    };
    if (!new Set(["hard", "clay", "grass"]).has(surfaceKey)) {
      Object.assign(result, {
        評級: "場地待補",
        分析狀態: "surface_missing",
        判定原因: ["場地來源尚未取得Hard／Clay／Grass。"]
      });
      return addUiAliases(jsonClean(result));
    }
    if (foundCount < 2) {
      Object.assign(result, {
        評級: "資料不足",
        分析狀態: "player_not_found",
        判定原因: ["至少一位球員無法由TennisRatio確認。"]
      });
      return applyExpiry(addUiAliases(jsonClean(result)));
    }
    if (!homePlayer?.all_surface_sample_valid || !awayPlayer?.all_surface_sample_valid) {
      Object.assign(result, {
        評級: "資料不足",
        分析狀態: "surface_sample_missing",
        判定原因: [`${surface}至少一位球員沒有有效All Levels樣本。`]
      });
      return applyExpiry(addUiAliases(jsonClean(result)));
    }

    const [hotPlayer, coldPlayer] = selectHotCold(result, homePlayer, awayPlayer);
    const hotName = String(result.熱門方 || "");
    const coldName = String(result.熱門方位置 === "主場" ? result.客場 : result.主場);
    let formula;
    try {
      formula = calculateFormulaB({
        hotOdds: result.熱門方賠率,
        coldOdds: coldOdds(result),
        hotRank: hotPlayer.rank,
        coldRank: coldPlayer.rank,
        allStatsHot: ratingPlayerStats(hotPlayer, "all_surface"),
        allStatsCold: ratingPlayerStats(coldPlayer, "all_surface"),
        mainStatsHot: hotPlayer.main_surface_sample_valid
          ? ratingPlayerStats(hotPlayer, "main_surface") : {},
        mainStatsCold: coldPlayer.main_surface_sample_valid
          ? ratingPlayerStats(coldPlayer, "main_surface") : {},
        config,
        tournamentLevel: matchDetails.tournament_level,
        roundName: matchDetails.round_name
      });
    } catch (error) {
      if (!(error instanceof FormulaBError)) throw error;
      Object.assign(result, {
        評級: "資料不足",
        分析狀態: "formula_b_unavailable",
        判定原因: [`Formula B無法計算：${error.message}`]
      });
      return applyExpiry(addUiAliases(jsonClean(result)));
    }

    const ratingProbability = formula.probability;
    const hotOddsValue = Number(result.熱門方賠率);
    const ratingEv = ratingProbability * hotOddsValue - 1;
    const ratingComparison = buildRatingComparison(
      formula.component_rows,
      String(hotPlayer.正式姓名 || hotName),
      String(coldPlayer.正式姓名 || coldName),
      String(result.熱門方位置 || "") || null
    );
    const decision = ratingDecision({
      probability: ratingProbability,
      evPct: ratingEv * 100,
      hotSupportCount: formula.hot_better_component_count,
      componentCount: formula.component_count,
      config
    });
    const formalHotName = String(hotPlayer.正式姓名 || hotName);
    const formalColdName = String(coldPlayer.正式姓名 || coldName);
    let bo3Prediction;
    try {
      bo3Prediction = calculateBO3Prediction({
        matchProbability: ratingProbability,
        hotName: formalHotName,
        coldName: formalColdName,
        blendedHot: formula.blended_hot,
        blendedCold: formula.blended_cold
      });
    } catch (error) {
      if (!(error instanceof BO3ModelError)) throw error;
      bo3Prediction = {
        名稱: BO3_MODEL_NAME,
        版本: BO3_MODEL_VERSION,
        狀態: "unavailable",
        賽制: "BO3",
        原因: error.message
      };
    }
    const grade = String(decision.最終評級);
    const allLevelsWeight = formula.all_levels_weight;
    const dataMode = formula.main_weight >= 0.9995
      ? "Main Tour｜同場地"
      : formula.main_weight <= 0.0005
        ? "All Levels｜同場地"
        : "Main Tour＋All Levels混合";
    const dataModeDetail = `${dataMode}；Main Tour ${percentage1(formula.main_weight)}、All Levels ${percentage1(allLevelsWeight)}。`;

    Object.assign(result, {
      Pinnacle去水勝率: formula.fair_market_probability,
      公式B勝率: ratingProbability,
      公式B公平賠率: 1 / ratingProbability,
      "公式B EV": ratingEv,
      "公式B EV百分比": ratingEv * 100,
      公式B狀態: formula.signal_label,
      評級: grade === "淘汰" && result.已過期 ? "淘汰＋過期" : grade,
      評級五項比較: ratingComparison,
      評級判定: decision,
      BO3機械預測: bo3Prediction,
      分析狀態: "complete",
      判定原因: [
        `Formula B計算對象：熱門方「${hotName}」（Pinnacle低賠方）。`,
        `排名情境：${formula.rank_scenario}；${formula.rank_scenario_description}`,
        `情境處置：${formula.rank_scenario_action}`,
        `數據來源：${dataModeDetail}`,
        `混合依據：${formula.main_weight_reason}；賽事Main係數${percentage0(formula.event_main_factor)}。`,
        `排名計算：D=${plusFixed(formula.data_score, 4)}、原始排名訊號=${plusFixed(formula.raw_rank_signal, 4)}、` +
          `作用比例=${percentage0(formula.rank_effect_factor)}（${formula.hot_better_component_count}/${formula.component_count}項）、` +
          `實際排名修正=${plusFixed(formula.rank_adjustment, 4)}。`,
        `公式B EV＝勝率×熱門方賠率−1＝${plusFixed(ratingEv * 100, 2)}%。`,
        `兩道門檻：EV${decision.評級EV等級}、五項上限${decision.五項支持上限}，最終${decision.最終評級}；評級勝率僅供參考。`
      ],
      模型: {
        名稱: FORMULA_NAME,
        版本: formula.parameters.version,
        計算對象: "熱門方（Pinnacle低賠方）",
        模型方向: MODEL_ORIENTATION,
        熱門方球員: hotName,
        熱門方排名: hotPlayer.rank,
        熱門方賠率: result.熱門方賠率,
        對手球員: coldName,
        對手排名: coldPlayer.rank,
        對手賠率: coldOdds(result),
        Main權重: formula.main_weight,
        "All Levels權重": allLevelsWeight,
        賽事Main係數: formula.event_main_factor,
        熱門方Main樣本: formula.main_hot_sample,
        對手Main樣本: formula.main_cold_sample,
        Main有效樣本: formula.main_effective_sample,
        Main樣本可信度: formula.main_sample_reliability,
        混合權重說明: formula.main_weight_reason,
        數據使用模式: dataMode,
        數據使用說明: dataModeDetail,
        評級判定: decision,
        Pinnacle去水勝率: formula.fair_market_probability,
        固定基準加值: formula.base_uplift,
        項目計算: formula.component_rows,
        熱門方混合數據: formula.blended_hot,
        對手混合數據: formula.blended_cold,
        D數據差: formula.data_score,
        R排名差: formula.rank_log_gap,
        Q排名可信度: formula.rank_reliability,
        排名情境代碼: formula.rank_scenario_code,
        排名情境: formula.rank_scenario,
        排名情境說明: formula.rank_scenario_description,
        排名情境處置: formula.rank_scenario_action,
        熱門方五項較優數: formula.hot_better_component_count,
        五項比較數: formula.component_count,
        原始排名訊號: formula.raw_rank_signal,
        排名作用比例: formula.rank_effect_factor,
        實際排名修正: formula.rank_adjustment,
        原始排名救援項: formula.raw_rank_rescue,
        排名救援保留率: formula.rank_rescue_factor,
        排名救援支持項數: formula.hot_better_component_count,
        排名救援比較項數: formula.component_count,
        排名救援項: formula.rank_rescue,
        B訊號: formula.signal,
        TANH訊號: formula.tanh_signal,
        數據排名修正: formula.data_rank_adjustment,
        公式B勝率: formula.probability,
        公式B狀態: formula.signal_label,
        參數: formula.parameters,
        公式: "Clamp(Pinnacle去水勝率 + 0.023 + 0.031×TANH(D + 情境化排名修正), 50%, 80%)",
        原始結果: deepClone(formula)
      }
    });
    return addUiAliases(jsonClean(result));
  }

  function analyzeSourceMatch(sourceMatch, config, now) {
    const result = baseResult(sourceMatch, now);
    result.主場名次 = sourceMatch?.主場名次 ?? sourceMatch?.TennisRatio?.主場球員?.rank ?? null;
    result.客場名次 = sourceMatch?.客場名次 ?? sourceMatch?.TennisRatio?.客場球員?.rank ?? null;
    result.比賽資訊 = deepClone(sourceMatch?.比賽資訊 || result.比賽資訊);
    result.Pinnacle比賽資訊 = deepClone(sourceMatch?.Pinnacle比賽資訊 || result.Pinnacle比賽資訊);
    result["365Scores"] = deepClone(sourceMatch?.["365Scores"] || {});
    result.TennisRatio賽事場地 = deepClone(sourceMatch?.TennisRatio賽事場地 || {});
    result.TennisRatio = deepClone(sourceMatch?.TennisRatio || {});
    const homePlayer = result.TennisRatio?.主場球員 || {};
    const awayPlayer = result.TennisRatio?.客場球員 || {};
    return evaluate(result, homePlayer, awayPlayer, config);
  }

  function statusCounts(matches, field) {
    const output = {};
    for (const item of matches) {
      const key = String(item?.[field] || "unknown");
      output[key] = (output[key] || 0) + 1;
    }
    return output;
  }

  function isoTaipei(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    const text = utils.taipeiDateText(date, true);
    return text ? `${text.replace(" ", "T")}+08:00` : date.toISOString();
  }

  async function buildAnalysis(sourceBundle, config, options = {}) {
    const rows = Array.isArray(sourceBundle?.matches)
      ? sourceBundle.matches.filter(item => item && typeof item === "object")
      : [];
    const now = options.now instanceof Date ? options.now :
      options.now ? new Date(options.now) : new Date();
    const matches = [];
    for (let index = 0; index < rows.length; index += 1) {
      const result = analyzeSourceMatch(rows[index], config || {}, now);
      matches.push(result);
      if (typeof options.progress === "function") {
        options.progress(
          `Phase 4｜分析 ${index + 1}/${rows.length}：${result.主場} vs ${result.客場}｜${result.評級}`,
          { completed: index + 1, total: rows.length, item: result.項次 }
        );
      }
      if ((index + 1) % 3 === 0) await Promise.resolve();
    }
    return {
      version: APP_VERSION,
      generated_at_taiwan: isoTaipei(now),
      source: {
        Pinnacle: "選手、賠率、低賠方、比賽、聯賽、層級、輪次與時間",
        "365比分網": "ATP／WTA主巡迴場地（不含WTA 125）",
        TennisRatio賽程: "ATP Challenger與WTA 125場地；另提供球員識別資料",
        TennisRatio球員: "雙方正式姓名、Profile、排名與指定場地統計",
        "Formula B": "以熱門方排名、雙方TennisRatio數據與Pinnacle去水勝率計算",
        比較結果: "原始15項與評級5項的較優方、較優選手及統計",
        BO3機械預測: "以評級勝率反推單盤勝率，並用混合保發率與破發率推算盤數機率與總局數"
      },
      comparison_policy: {
        原始指標項目數: 15,
        原始指標範圍: ["All Levels｜同場地", "Main Tour｜同場地"],
        樣本是否計分: false,
        數值越低越好: ["doublefaults_per_match"],
        其餘原始指標: "數值越高越好",
        平手: "雙方皆不加分",
        評級比較項目數: 5,
        缺失資料: "標記為資料不足，不推測較優方"
      },
      model_policy: {
        calculation_subject: "Pinnacle低賠熱門方hot",
        calculation_orientation: MODEL_ORIENTATION,
        home_away_probability_inversion: false,
        賠轉勝率公式: "1 ÷ 熱門方賠率",
        Pinnacle去水勝率公式: "(1÷熱門方賠率) ÷ ((1÷熱門方賠率)+(1÷對手賠率))",
        "Formula B": "Clamp(P0+0.023+0.031×TANH(D+情境化排名修正),50%,80%)",
        數據混合規則: "Main權重=賽事Main係數×min(1,Main調和有效樣本/10)；主巡迴會內賽係數100%、資格賽50%、ATP Challenger／WTA 125／ITF係數0%；兩人Main必要數據都完整才使用，否則Main權重為0",
        排名情境規則: {
          "排名好＋數據差0至2項": "排名救援；保留20%、36%、52%原始排名訊號",
          "排名好＋數據好3至5項": "排名確認；只取原始排名訊號10%，上限0.35，再乘五項支持率",
          "排名差＋數據差0至2項": "放棄區；不救援並保留100%排名負向扣分",
          "排名差＋數據好3至5項": "數據逆排名；分別保留80%、60%、40%排名負向扣分"
        },
        評級EV公式: "公式B勝率 × 熱門方賠率 − 1",
        BO3機械預測: "評級勝率反推單盤勝率；混合保發率與破發率決定單盤比分分布；精確枚舉BO3盤數機率與總局數，無隨機抽樣",
        rating_thresholds: "兩道門檻取最低：A需EV≥7%且五項5/5；B需EV≥4%且五項≥4/5；C需EV>0%且五項≥3/5；五項≤2/5直接淘汰；評級勝率僅供參考與BO3預測，不限制A/B/C"
      },
      "365Scores_errors": deepClone(sourceBundle?.source_errors?.["365Scores"] || {}),
      TennisRatio_schedule_errors: deepClone(sourceBundle?.source_errors?.TennisRatio_schedule || {}),
      run_health: {
        input_matches: rows.length,
        status_counts: statusCounts(matches, "分析狀態"),
        rating_counts: statusCounts(matches, "評級")
      },
      matches
    };
  }

  return {
    FORMULA_NAME,
    APP_VERSION,
    REQUIRED_METRICS,
    RAW_METRICS,
    FormulaBError,
    BO3ModelError,
    fairMarketProbability,
    calculateFormulaB,
    buildRawComparisons,
    buildRatingComparison,
    calculateBO3Prediction,
    ratingDecision,
    favorite,
    expired,
    baseResult,
    evaluate,
    analyzeSourceMatch,
    buildAnalysis,
    jsonClean
  };
});
