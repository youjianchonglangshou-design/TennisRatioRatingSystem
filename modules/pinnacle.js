(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TennisRatioPinnacle = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MATCHUPS_URL =
    "https://guest.api.arcadia.pinnacle.com/0.1/sports/33/matchups?withSpecials=false";
  const MARKETS_URL =
    "https://guest.api.arcadia.pinnacle.com/0.1/sports/33/markets/straight?primaryOnly=false&withSpecials=false";

  const LEAGUE_LEVEL_BY_ID = new Map([
    [4359, "ATP 500"],
    [4380, "ATP 500"],
    [5007, "WTA 500"],
    [5015, "WTA 500"],
    [197386, "ATP 250"],
    [197392, "ATP 250"],
    [221306, "ATP 1000"],
    [206049, "WTA 1000"],
    [221518, "WTA 125"]
  ]);

  const LEAGUE_LEVEL_BY_NAME = [
    ["AUSTRALIAN OPEN", "Grand Slam"],
    ["ROLAND GARROS", "Grand Slam"],
    ["FRENCH OPEN", "Grand Slam"],
    ["WIMBLEDON", "Grand Slam"],
    ["US OPEN", "Grand Slam"],
    ["ATP INDIAN WELLS", "ATP 1000"],
    ["ATP MIAMI", "ATP 1000"],
    ["ATP MONTE CARLO", "ATP 1000"],
    ["ATP MONTE-CARLO", "ATP 1000"],
    ["ATP MADRID", "ATP 1000"],
    ["ATP ROME", "ATP 1000"],
    ["ATP MONTREAL", "ATP 1000"],
    ["ATP TORONTO", "ATP 1000"],
    ["ATP CINCINNATI", "ATP 1000"],
    ["ATP SHANGHAI", "ATP 1000"],
    ["ATP PARIS", "ATP 1000"],
    ["ATP WASHINGTON", "ATP 500"],
    ["ATP DALLAS", "ATP 500"],
    ["ATP ROTTERDAM", "ATP 500"],
    ["ATP DOHA", "ATP 500"],
    ["ATP RIO", "ATP 500"],
    ["ATP ACAPULCO", "ATP 500"],
    ["ATP DUBAI", "ATP 500"],
    ["ATP BARCELONA", "ATP 500"],
    ["ATP MUNICH", "ATP 500"],
    ["ATP HAMBURG", "ATP 500"],
    ["ATP HALLE", "ATP 500"],
    ["ATP QUEENS", "ATP 500"],
    ["ATP LONDON", "ATP 500"],
    ["ATP TOKYO", "ATP 500"],
    ["ATP BEIJING", "ATP 500"],
    ["ATP VIENNA", "ATP 500"],
    ["ATP BASEL", "ATP 500"],
    ["ATP LOS CABOS", "ATP 250"],
    ["ATP WINSTON SALEM", "ATP 250"],
    ["ATP WINSTON-SALEM", "ATP 250"],
    ["ATP BRISBANE", "ATP 250"],
    ["ATP HONG KONG", "ATP 250"],
    ["ATP ADELAIDE", "ATP 250"],
    ["ATP AUCKLAND", "ATP 250"],
    ["ATP MONTPELLIER", "ATP 250"],
    ["ATP BUENOS AIRES", "ATP 250"],
    ["ATP DELRAY BEACH", "ATP 250"],
    ["ATP SANTIAGO", "ATP 250"],
    ["ATP BUCHAREST", "ATP 250"],
    ["ATP HOUSTON", "ATP 250"],
    ["ATP MARRAKECH", "ATP 250"],
    ["ATP GENEVA", "ATP 250"],
    ["ATP STUTTGART", "ATP 250"],
    ["ATP HERTOGENBOSCH", "ATP 250"],
    ["ATP MALLORCA", "ATP 250"],
    ["ATP EASTBOURNE", "ATP 250"],
    ["ATP BASTAD", "ATP 250"],
    ["ATP GSTAAD", "ATP 250"],
    ["ATP UMAG", "ATP 250"],
    ["ATP KITZBUHEL", "ATP 250"],
    ["ATP ESTORIL", "ATP 250"],
    ["ATP CHENGDU", "ATP 250"],
    ["ATP HANGZHOU", "ATP 250"],
    ["ATP ALMATY", "ATP 250"],
    ["ATP STOCKHOLM", "ATP 250"],
    ["WTA INDIAN WELLS", "WTA 1000"],
    ["WTA MIAMI", "WTA 1000"],
    ["WTA MADRID", "WTA 1000"],
    ["WTA ROME", "WTA 1000"],
    ["WTA TORONTO", "WTA 1000"],
    ["WTA MONTREAL", "WTA 1000"],
    ["WTA CINCINNATI", "WTA 1000"],
    ["WTA BEIJING", "WTA 1000"],
    ["WTA WUHAN", "WTA 1000"],
    ["WTA DOHA", "WTA 1000"],
    ["WTA DUBAI", "WTA 1000"],
    ["WTA WASHINGTON", "WTA 500"],
    ["WTA ADELAIDE", "WTA 500"],
    ["WTA ABU DHABI", "WTA 500"],
    ["WTA CHARLESTON", "WTA 500"],
    ["WTA STUTTGART", "WTA 500"],
    ["WTA BERLIN", "WTA 500"],
    ["WTA BAD HOMBURG", "WTA 500"],
    ["WTA EASTBOURNE", "WTA 500"],
    ["WTA SEOUL", "WTA 500"],
    ["WTA TOKYO", "WTA 500"],
    ["WTA NINGBO", "WTA 500"],
    ["WTA 125K VANCOUVER", "WTA 125"]
  ];

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function decimalOdds(american) {
    if (american === "鎖盤中" || american === null || american === undefined) {
      return "鎖盤中";
    }
    const value = finiteNumber(american);
    if (value === null || value === 0) return "鎖盤中";
    const result = value > 0
      ? value / 100 + 1
      : 100 / Math.abs(value) + 1;
    return Number(result.toFixed(3));
  }

  function tournamentLevel(league) {
    const leagueData = league && typeof league === "object" && !Array.isArray(league)
      ? league
      : null;
    const leagueName = leagueData
      ? String(leagueData.name || "")
      : String(league || "");
    const leagueId = leagueData ? leagueData.id : null;
    const text = leagueName.toLocaleLowerCase("en-US");
    const upperName = leagueName.toLocaleUpperCase("en-US");
    const isWta = /\bwta\b|\bwomen\b/i.test(text);
    const isAtp = /\batp\b|\bmen\b/i.test(text);

    if (
      text.includes("grand slam") ||
      ["wimbledon", "roland garros", "us open", "australian open"]
        .some(token => text.includes(token))
    ) return "Grand Slam";
    if (text.includes("wta 125") || text.includes("wta125")) return "WTA 125";
    if (text.includes("challenger")) return "ATP Challenger";
    if (text.includes("itf") || text.includes("futures")) return "ITF/Futures";

    const explicit = text.match(/\b(atp|wta)\s*(1000|500|250)\b/i);
    if (explicit) return `${explicit[1].toLocaleUpperCase("en-US")} ${explicit[2]}`;

    if (Number.isInteger(leagueId) && LEAGUE_LEVEL_BY_ID.has(leagueId)) {
      return LEAGUE_LEVEL_BY_ID.get(leagueId);
    }

    for (const [fragment, level] of LEAGUE_LEVEL_BY_NAME) {
      if (upperName.includes(fragment)) return level;
    }

    if (isWta) {
      if (text.includes("washington")) return "WTA 500";
      if (text.includes("memphis")) return "WTA 250";
      return "WTA";
    }
    if (isAtp) {
      if (text.includes("washington")) return "ATP 500";
      if (text.includes("los cabos")) return "ATP 250";
      return "ATP";
    }
    return null;
  }

  function leagueNameForOutput(league) {
    const leagueData =
      league && typeof league === "object" && !Array.isArray(league)
        ? league
        : null;
    const rawName = leagueData
      ? String(leagueData.name || "未知")
      : String(league || "未知");
    const resolvedLevel = tournamentLevel(leagueData || rawName);

    if (
      !resolvedLevel ||
      resolvedLevel === "ATP" ||
      resolvedLevel === "WTA" ||
      resolvedLevel === "Grand Slam" ||
      resolvedLevel === "ITF/Futures"
    ) return rawName;

    const explicitPatterns = {
      "ATP 1000": /\bATP\s*1000\b/i,
      "ATP 500": /\bATP\s*500\b/i,
      "ATP 250": /\bATP\s*250\b/i,
      "ATP Challenger": /\bATP\s+Challenger\b|\bChallenger\b/i,
      "WTA 1000": /\bWTA\s*1000\b/i,
      "WTA 500": /\bWTA\s*500\b/i,
      "WTA 250": /\bWTA\s*250\b/i,
      "WTA 125": /\bWTA\s*125K?\b/i
    };
    if (explicitPatterns[resolvedLevel]?.test(rawName)) return rawName;

    if (resolvedLevel === "ATP Challenger") {
      if (/^\s*ATP\b/i.test(rawName)) {
        return rawName.replace(/^\s*ATP\b/i, "ATP Challenger");
      }
      return `ATP Challenger ${rawName}`.trim();
    }
    if (resolvedLevel.startsWith("ATP ")) {
      if (/^\s*ATP\b/i.test(rawName)) {
        return rawName.replace(
          /^\s*ATP(?:\s*(?:1000|500|250))?\b/i,
          resolvedLevel
        );
      }
      return `${resolvedLevel} ${rawName}`.trim();
    }
    if (resolvedLevel.startsWith("WTA ")) {
      if (/^\s*WTA\b/i.test(rawName)) {
        return rawName.replace(
          /^\s*WTA(?:\s*(?:1000|500|250|125K?))?\b/i,
          resolvedLevel
        );
      }
      return `${resolvedLevel} ${rawName}`.trim();
    }
    return rawName;
  }

  function excludedLeague(league) {
    const normalized = String(league || "")
      .toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return normalized.split(/\s+/).includes("itf");
  }

  function doubles(league, participants) {
    const normalized = String(league || "")
      .toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const tokens = new Set(normalized.split(/\s+/));
    if (["double", "doubles", "dobles"].some(token => tokens.has(token))) {
      return true;
    }
    const home = String(participants?.home || "");
    const away = String(participants?.away || "");
    return home.includes("/") && away.includes("/");
  }

  function taipeiParts(date) {
    return Object.fromEntries(
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
  }

  function formatTaipei(date, includeSeconds = false) {
    const parts = taipeiParts(date);
    const base = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    return includeSeconds ? `${base}:${parts.second}` : base;
  }

  function parseStart(matchup) {
    let raw = matchup?.startTime;
    if (!raw && Array.isArray(matchup?.periods)) {
      const period = matchup.periods.find(item =>
        item && Number(item.period) === 0 && item.cutoffAt
      );
      raw = period?.cutoffAt;
    }
    if (!raw) return { text: "未知", sortValue: Number.MAX_SAFE_INTEGER };
    const parsed = new Date(String(raw));
    if (Number.isNaN(parsed.getTime())) {
      return { text: "時間錯誤", sortValue: Number.MAX_SAFE_INTEGER };
    }
    return { text: formatTaipei(parsed), sortValue: parsed.getTime() };
  }

  function participantsFor(matchup) {
    const participants = {};
    if (!Array.isArray(matchup?.participants)) return participants;
    for (const item of matchup.participants) {
      if (!item || typeof item !== "object") continue;
      participants[item.alignment] = item.name;
    }
    return participants;
  }

  function buildOddsMap(markets) {
    const oddsMap = new Map();
    if (!Array.isArray(markets)) return oddsMap;
    for (const market of markets) {
      if (!market || market.type !== "moneyline" || Number(market.period) !== 0) {
        continue;
      }
      const prices = {};
      if (Array.isArray(market.prices)) {
        for (const item of market.prices) {
          if (!item || typeof item !== "object") continue;
          prices[item.designation] = item.price;
        }
      }
      oddsMap.set(String(market.matchupId), {
        home: decimalOdds(prices.home),
        away: decimalOdds(prices.away)
      });
    }
    return oddsMap;
  }

  function fetchMatchesFromRaw(matchups, markets, options = {}) {
    const filterEnabled = options.filterEnabled !== false;
    const minOdds = finiteNumber(options.minOdds) ?? 1.5;
    const maxOdds = finiteNumber(options.maxOdds) ?? 1.75;
    const oddsMap = buildOddsMap(markets);
    const rows = [];

    for (const matchup of Array.isArray(matchups) ? matchups : []) {
      if (!matchup || typeof matchup !== "object") continue;
      const league = leagueNameForOutput(matchup.league || {});
      const participants = participantsFor(matchup);
      if (excludedLeague(league) || doubles(league, participants)) continue;

      const start = parseStart(matchup);
      const market = oddsMap.get(String(matchup.id)) || {
        home: "鎖盤中",
        away: "鎖盤中"
      };
      const homeOdds = market.home;
      const awayOdds = market.away;

      if (filterEnabled) {
        const inRange =
          (typeof homeOdds === "number" && homeOdds >= minOdds && homeOdds <= maxOdds) ||
          (typeof awayOdds === "number" && awayOdds >= minOdds && awayOdds <= maxOdds);
        if (!inRange) continue;
      }

      const pinnacleMatchupId = matchup.id ?? null;
      rows.push({
        _sort: start.sortValue,
        match_id: pinnacleMatchupId !== null ? `pinnacle_${String(pinnacleMatchupId)}` : null,
        Pinnacle賽事ID: pinnacleMatchupId,
        日期時間: start.text,
        聯賽: league,
        主場: participants.home || "未知",
        客場: participants.away || "未知",
        主場賠率: homeOdds,
        客場賠率: awayOdds
      });
    }

    rows.sort((left, right) => left._sort - right._sort);
    return rows.map((row, index) => {
      const { _sort, ...clean } = row;
      return { 項次: index + 1, ...clean };
    });
  }

  function payloadFromMatches(matches, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const minOdds = finiteNumber(options.minOdds) ?? 1.5;
    const maxOdds = finiteNumber(options.maxOdds) ?? 1.75;
    const parts = taipeiParts(now);
    const canonicalFields = [
      "項次", "match_id", "Pinnacle賽事ID", "日期時間", "聯賽",
      "主場", "客場", "主場賠率", "客場賠率"
    ];
    const canonicalMatches = (Array.isArray(matches) ? matches : [])
      .filter(item => item && typeof item === "object")
      .map(item => Object.fromEntries(canonicalFields.map(key => [key, item[key] ?? null])));

    return {
      batch_date: `${parts.year}-${parts.month}-${parts.day}`,
      query_time: formatTaipei(now, true),
      timezone: "Asia/Taipei",
      filter: {
        enabled: true,
        min_odds: minOdds,
        max_odds: maxOdds,
        excluded_leagues: ["ITF"],
        excluded_match_types: ["Doubles"]
      },
      matches: canonicalMatches
    };
  }

  function buildTodayMatches(matchups, markets, options = {}) {
    const matches = fetchMatchesFromRaw(matchups, markets, options);
    return payloadFromMatches(matches, options);
  }

  async function fetchArcadiaJson(url, apiKey) {
    const key = String(apiKey || "").trim();
    if (!key) throw new Error("ARCADIA_API_KEY 尚未填入。");
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-api-key": key
      },
      cache: "no-store"
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        const payload = JSON.parse(text);
        detail = payload.detail || payload.title || payload.error || text;
      } catch {
        // 保留原始文字。
      }
      throw new Error(`Arcadia HTTP ${response.status}：${detail}`);
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Arcadia 回傳內容不是有效 JSON。");
    }
    if (!Array.isArray(payload)) {
      throw new Error("Arcadia 回傳格式異常，預期為陣列。");
    }
    return payload.filter(item => item && typeof item === "object");
  }

  return {
    MATCHUPS_URL,
    MARKETS_URL,
    LEAGUE_LEVEL_BY_ID,
    LEAGUE_LEVEL_BY_NAME,
    decimalOdds,
    tournamentLevel,
    leagueNameForOutput,
    excludedLeague,
    doubles,
    parseStart,
    fetchMatchesFromRaw,
    payloadFromMatches,
    buildTodayMatches,
    fetchArcadiaJson
  };
});
