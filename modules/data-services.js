/*
 * TennisRatio data-services.js
 * 結構整合版 v1
 *
 * 合併：
 * - source-utils.js
 * - scores365.js
 * - tennisratio.js
 * - source-pipeline.js
 * - r2-client.js
 *
 * 各模組仍維持原本的 window.TennisRatio... 公開介面，
 * app.js 不需要修改。
 */


/* ============================================================
   source-utils.js｜共用姓名、時間、層級與場地工具
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TennisRatioSourceUtils = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SURFACES = new Set(["Hard", "Clay", "Grass"]);

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
    ["WTA 125K VANCOUVER", "WTA 125"],
  ];

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function stripDiacritics(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ß/g, "ss");
  }

  function normalize(value) {
    return stripDiacritics(value)
      .toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]/g, "");
  }

  function nameTokens(value) {
    return stripDiacritics(value)
      .toLocaleLowerCase("en-US")
      .match(/[a-z0-9]+/g) || [];
  }

  // Ratcliff/Obershelp style ratio. This follows the same shape as
  // Python difflib.SequenceMatcher for the short player/tournament strings
  // used by the original project.
  function longestMatch(left, right, aLow, aHigh, bLow, bHigh) {
    let bestA = aLow;
    let bestB = bLow;
    let bestSize = 0;
    const index = new Map();

    for (let j = bLow; j < bHigh; j += 1) {
      const char = right[j];
      if (!index.has(char)) index.set(char, []);
      index.get(char).push(j);
    }

    let previous = new Map();
    for (let i = aLow; i < aHigh; i += 1) {
      const current = new Map();
      for (const j of index.get(left[i]) || []) {
        if (j < bLow || j >= bHigh) continue;
        const size = (previous.get(j - 1) || 0) + 1;
        current.set(j, size);
        if (size > bestSize) {
          bestA = i - size + 1;
          bestB = j - size + 1;
          bestSize = size;
        }
      }
      previous = current;
    }

    while (
      bestA > aLow &&
      bestB > bLow &&
      left[bestA - 1] === right[bestB - 1]
    ) {
      bestA -= 1;
      bestB -= 1;
      bestSize += 1;
    }
    while (
      bestA + bestSize < aHigh &&
      bestB + bestSize < bHigh &&
      left[bestA + bestSize] === right[bestB + bestSize]
    ) {
      bestSize += 1;
    }

    return { a: bestA, b: bestB, size: bestSize };
  }

  function matchingBlocks(left, right) {
    const queue = [[0, left.length, 0, right.length]];
    const blocks = [];

    while (queue.length) {
      const [aLow, aHigh, bLow, bHigh] = queue.pop();
      const match = longestMatch(left, right, aLow, aHigh, bLow, bHigh);
      if (!match.size) continue;
      blocks.push(match);
      if (aLow < match.a && bLow < match.b) {
        queue.push([aLow, match.a, bLow, match.b]);
      }
      if (
        match.a + match.size < aHigh &&
        match.b + match.size < bHigh
      ) {
        queue.push([
          match.a + match.size,
          aHigh,
          match.b + match.size,
          bHigh
        ]);
      }
    }

    blocks.sort((x, y) => x.a - y.a || x.b - y.b);
    const collapsed = [];
    for (const block of blocks) {
      const last = collapsed[collapsed.length - 1];
      if (
        last &&
        last.a + last.size === block.a &&
        last.b + last.size === block.b
      ) {
        last.size += block.size;
      } else {
        collapsed.push({ ...block });
      }
    }
    return collapsed;
  }

  function similarity(leftValue, rightValue) {
    const left = normalize(leftValue);
    const right = normalize(rightValue);
    if (left && left === right) return 1;
    if (!left || !right) return 0;
    const matched = matchingBlocks(left, right)
      .reduce((total, block) => total + block.size, 0);
    return (2 * matched) / (left.length + right.length);
  }

  function compatibleName(expected, actual) {
    const expectedTokens = nameTokens(expected);
    const actualTokens = nameTokens(actual);
    if (!expectedTokens.length || !actualTokens.length) return false;
    if (normalize(expected) === normalize(actual)) return true;

    const expectedSet = new Set(expectedTokens);
    const actualSet = new Set(actualTokens);
    const expectedSubset = [...expectedSet].every(item => actualSet.has(item));
    const actualSubset = [...actualSet].every(item => expectedSet.has(item));
    if (expectedSubset || actualSubset) return true;

    if (
      expectedTokens[0] === actualTokens[0] &&
      expectedTokens.at(-1) === actualTokens.at(-1)
    ) {
      return true;
    }

    const firstExpected = expectedTokens[0];
    const firstActual = actualTokens[0];
    if (
      expectedTokens.at(-1) === actualTokens.at(-1) &&
      Math.min(firstExpected.length, firstActual.length) >= 4 &&
      (firstExpected.startsWith(firstActual) || firstActual.startsWith(firstExpected))
    ) {
      return true;
    }
    return similarity(expected, actual) >= 0.88;
  }

  function parseTaipeiDateTime(value) {
    const text = String(value || "").trim();
    if (!text) return null;

    // The canonical today_matches format is already Asia/Taipei local time.
    let match = text.match(
      /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
    );
    if (match) {
      const [, year, month, day, hour, minute, second = "00"] = match;
      return new Date(
        `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`
      );
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function taipeiDateText(dateValue, includeSeconds = false) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: includeSeconds ? "2-digit" : undefined,
        hourCycle: "h23"
      })
        .formatToParts(date)
        .filter(part => part.type !== "literal")
        .map(part => [part.type, part.value])
    );
    return includeSeconds
      ? `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
      : `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  }

  function roundName(league) {
    const text = String(league || "");
    const rules = [
      [/semi[- ]?final|\bsf\b/i, "Semifinal"],
      [/quarter[- ]?final|\bqf\b/i, "Quarterfinal"],
      [/\bfinal/i, "Final"],
      [/round\s+of\s+128|\br128\b/i, "R128"],
      [/round\s+of\s+64|\br64\b/i, "R64"],
      [/round\s+of\s+32|\br32\b/i, "R32"],
      [/round\s+of\s+16|\br16\b/i, "R16"],
      [/\bthird\s+round\b|\br3\b/i, "R3"],
      [/\bsecond\s+round\b|\br2\b/i, "R2"],
      [/\bfirst\s+round\b|\br1\b/i, "R1"],
      [/qualif|qualies/i, "Qualifying"]
    ];
    const found = rules.find(([pattern]) => pattern.test(text));
    return found ? found[1] : null;
  }

  function tournamentLevel(league) {
    const raw = String(league || "");
    const text = raw.toLocaleLowerCase("en-US");
    const upperName = raw.toLocaleUpperCase("en-US");

    if (
      text.includes("grand slam") ||
      ["wimbledon", "roland garros", "us open", "australian open"]
        .some(token => text.includes(token))
    ) return "Grand Slam";
    if (/wta\s*125|wta125/.test(text)) return "WTA 125";
    if (text.includes("challenger")) return "ATP Challenger";
    if (text.includes("itf") || text.includes("futures")) return "ITF/Futures";

    const explicit = text.match(/\b(atp|wta)\s*(1000|500|250)\b/);
    if (explicit) return `${explicit[1].toUpperCase()} ${explicit[2]}`;

    for (const [fragment, level] of LEAGUE_LEVEL_BY_NAME) {
      if (upperName.includes(fragment)) return level;
    }

    if (/\bwta\b|\bwomen\b/.test(text)) {
      if (text.includes("washington")) return "WTA 500";
      if (text.includes("memphis")) return "WTA 250";
      return "WTA";
    }
    if (/\batp\b|\bmen\b/.test(text)) {
      if (text.includes("washington")) return "ATP 500";
      if (text.includes("los cabos")) return "ATP 250";
      return "ATP";
    }
    return null;
  }

  function tournamentName(rowOrLeague) {
    const value = rowOrLeague && typeof rowOrLeague === "object"
      ? rowOrLeague["聯賽"]
      : rowOrLeague;
    let text = String(value || "").trim();
    text = text.replace(/^\s*(?:ATP\s+Challenger|ATP|WTA)\s*/i, "");
    text = text.replace(/^\s*(?:1000|500|250|125)\s*K?\b[\s,.:/-]*/i, "");
    text = text.replace(
      /\s*[-|]\s*(?:R\d+|QF|SF|Round\s+of\s+\d+|Final|Semifinal|Quarterfinal|Qualifiers?|Qualifying|Qualies).*$/i,
      ""
    );
    return text.replace(/^[-|,\s]+|[-|,\s]+$/g, "");
  }

  function tour(row) {
    const text = String(row?.["聯賽"] || "").toLocaleLowerCase("en-US");
    if (text.includes("wta") || text.includes("women")) return "WTA";
    if (text.includes("atp") || text.includes("men") || text.includes("challenger")) {
      return "ATP";
    }
    return null;
  }

  function usesTennisRatioScheduleSurface(row) {
    return new Set(["ATP Challenger", "WTA 125"])
      .has(tournamentLevel(row?.["聯賽"]));
  }

  function compareUrl(homeName, awayName) {
    function slug(value) {
      return stripDiacritics(value)
        .match(/[A-Za-z0-9]+/g)
        ?.map(part => part.toLocaleLowerCase("en-US"))
        .join("-") || "";
    }
    const home = slug(homeName);
    const away = slug(awayName);
    return home && away
      ? `https://www.tennisratio.com/h2h-compare/${home}-vs-${away}.html`
      : null;
  }

  function matchInfo(row, options = {}) {
    const league = String(row?.["聯賽"] || "");
    const surface = options.surface || null;
    const surfaceSource = options.surfaceSource || null;
    return {
      source: surface && surfaceSource ? `Pinnacle＋${surfaceSource}` : "Pinnacle",
      display_text: league,
      tournament_name: tournamentName(league) || league || null,
      tournament_level: tournamentLevel(league),
      round_name: roundName(league),
      surface,
      surface_source: surfaceSource,
      date_text: row?.["日期時間"] ?? null,
      主場: row?.["主場"] ?? null,
      客場: row?.["客場"] ?? null
    };
  }

  function canonicalRound(value) {
    return roundName(value);
  }

  function isoTaipeiNow() {
    const text = taipeiDateText(new Date(), true);
    return text ? `${text.replace(" ", "T")}+08:00` : new Date().toISOString();
  }

  return {
    SURFACES,
    LEAGUE_LEVEL_BY_NAME,
    finiteNumber,
    stripDiacritics,
    normalize,
    nameTokens,
    similarity,
    compatibleName,
    parseTaipeiDateTime,
    taipeiDateText,
    roundName,
    tournamentLevel,
    tournamentName,
    tour,
    usesTennisRatioScheduleSurface,
    compareUrl,
    matchInfo,
    canonicalRound,
    isoTaipeiNow
  };
});


/* ============================================================
   scores365.js｜365Scores 場地與排名
   ============================================================ */
(function (root, factory) {
  const utils = typeof module === "object" && module.exports
    ? require("./source-utils.js")
    : root.TennisRatioSourceUtils;
  const api = factory(utils);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TennisRatioScores365 = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (utils) {
  "use strict";

  if (!utils) throw new Error("source-utils.js 尚未載入。");

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  async function responseDetail(response, fallback) {
    const text = await response.text();
    try {
      const payload = JSON.parse(text);
      return payload.error || payload.detail || payload.message || fallback;
    } catch {
      return text || fallback;
    }
  }

  async function fetchDay(workerUrl, dateValue) {
    const base = normalizeBaseUrl(workerUrl);
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (!base) throw new Error("WORKER_URL 尚未設定。");
    if (Number.isNaN(date.getTime())) throw new Error("365Scores日期無效。");

    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      })
        .formatToParts(date)
        .filter(part => part.type !== "literal")
        .map(part => [part.type, part.value])
    );
    const isoDate = `${parts.year}-${parts.month}-${parts.day}`;
    const response = await fetch(
      `${base}/source/365/day?date=${encodeURIComponent(isoDate)}&v=${Date.now()}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      const detail = await responseDetail(response, "365Scores日資料讀取失敗");
      throw new Error(`365Scores HTTP ${response.status}：${detail}`);
    }
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("365Scores回傳格式異常。");
    }
    return payload;
  }

  function names(game) {
    const home = game?.homeCompetitor && typeof game.homeCompetitor === "object"
      ? game.homeCompetitor
      : {};
    const away = game?.awayCompetitor && typeof game.awayCompetitor === "object"
      ? game.awayCompetitor
      : {};
    return [String(home.name || ""), String(away.name || "")];
  }

  function validRank(value) {
    const rank = Number(value);
    return Number.isInteger(rank) && rank > 0 ? rank : null;
  }

  function rankingPosition(competitor, tour = null) {
    if (!competitor || typeof competitor !== "object") return null;
    const rankings = Array.isArray(competitor.rankings)
      ? competitor.rankings
      : [];
    const desired = String(tour || "").toUpperCase();

    if (desired === "ATP" || desired === "WTA") {
      const exact = rankings.find(item =>
        String(item?.name || "").toUpperCase() === desired &&
        validRank(item?.position) !== null
      );
      if (exact) return validRank(exact.position);
    }

    for (const item of rankings) {
      const name = String(item?.name || "").toUpperCase();
      if (!new Set(["ATP", "WTA"]).has(name)) continue;
      const rank = validRank(item?.position);
      if (rank !== null) return rank;
    }

    return null;
  }

  function competitorIndex(payload) {
    const index = new Map();
    for (const item of Array.isArray(payload?.competitors) ? payload.competitors : []) {
      const id = utils.finiteNumber(item?.id);
      if (id !== null) index.set(Number(id), item);
    }
    return index;
  }

  function competitorWithFallback(primary, index) {
    if (!primary || typeof primary !== "object") return {};
    const id = utils.finiteNumber(primary.id);
    const indexed = id !== null ? index.get(Number(id)) : null;
    return indexed && typeof indexed === "object"
      ? { ...indexed, ...primary }
      : primary;
  }

  function match(row, snapshots) {
    const sourceHome = String(row?.["主場"] || "");
    const sourceAway = String(row?.["客場"] || "");
    const sourceTime = utils.parseTaipeiDateTime(row?.["日期時間"]);
    const league = String(row?.["聯賽"] || "");
    const candidates = [];

    for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
      const competitions = new Map();
      for (const item of Array.isArray(snapshot?.competitions) ? snapshot.competitions : []) {
        const id = utils.finiteNumber(item?.id);
        if (item && id !== null) competitions.set(Number(id), item);
      }

      for (const game of Array.isArray(snapshot?.games) ? snapshot.games : []) {
        if (!game || typeof game !== "object") continue;
        const [gameHome, gameAway] = names(game);
        if (!gameHome || !gameAway) continue;

        const direct = [
          utils.similarity(sourceHome, gameHome),
          utils.similarity(sourceAway, gameAway)
        ];
        const reverse = [
          utils.similarity(sourceHome, gameAway),
          utils.similarity(sourceAway, gameHome)
        ];
        const reversedPair = reverse[0] + reverse[1] > direct[0] + direct[1];
        const pairParts = reversedPair ? reverse : direct;
        const pairScore = (pairParts[0] + pairParts[1]) / 2;
        const exactCount = pairParts.filter(value => value >= 0.98).length;
        if (pairScore < 0.56 && exactCount === 0) continue;

        const gameTime = utils.parseTaipeiDateTime(game.startTime);
        const deltaHours = gameTime && sourceTime
          ? Math.abs(gameTime.getTime() - sourceTime.getTime()) / 3600000
          : null;
        const timeScore = deltaHours !== null
          ? Math.max(0, 1 - deltaHours / 18)
          : 0.35;
        const competition = String(
          game.competitionDisplayName ||
          competitions.get(Number(game.competitionId || 0))?.name ||
          ""
        );
        let competitionScore = utils.similarity(league, competition);
        const compactCompetition = competition
          .toLocaleLowerCase("en-US")
          .replace(/\s+/g, "");
        const compactLeague = league
          .toLocaleLowerCase("en-US")
          .replace(/\s+/g, "");
        if (
          compactCompetition &&
          compactLeague.includes(compactCompetition)
        ) {
          competitionScore = Math.max(competitionScore, 0.95);
        }
        let score = 0.72 * pairScore + 0.18 * timeScore + 0.10 * competitionScore;
        score += exactCount === 2 ? 0.08 : exactCount === 1 ? 0.04 : 0;
        candidates.push({
          score,
          exactCount,
          deltaHours,
          competitionScore,
          reversedPair,
          game,
          snapshot,
          competition,
          pairScore
        });
      }
    }

    if (!candidates.length) return null;
    candidates.sort((left, right) => right.score - left.score);
    const best = candidates[0];
    const secondScore = candidates[1]?.score ?? -1;
    const oneExactOk =
      best.exactCount >= 1 &&
      (best.deltaHours === null || best.deltaHours <= 8) &&
      best.competitionScore >= 0.45 &&
      best.score - secondScore >= 0.025;

    if (best.score < 0.72 && !(oneExactOk && best.score >= 0.62)) return null;
    if (best.score - secondScore < 0.025 && best.exactCount < 2) return null;

    const index = competitorIndex(best.snapshot);
    const gameHome = competitorWithFallback(best.game.homeCompetitor || {}, index);
    const gameAway = competitorWithFallback(best.game.awayCompetitor || {}, index);
    const sourceHomeCompetitor = best.reversedPair ? gameAway : gameHome;
    const sourceAwayCompetitor = best.reversedPair ? gameHome : gameAway;

    return {
      game: best.game,
      snapshot: best.snapshot,
      competition: best.competition,
      score: best.score,
      pair: best.pairScore,
      reversedPair: best.reversedPair,
      主場365姓名: String(sourceHomeCompetitor.name || ""),
      客場365姓名: String(sourceAwayCompetitor.name || ""),
      主場365競賽者: sourceHomeCompetitor,
      客場365競賽者: sourceAwayCompetitor
    };
  }

  function surfaceText(value) {
    const text = String(value || "").toLocaleLowerCase("en-US");
    for (const surface of ["hard", "clay", "grass"]) {
      if (new RegExp(`\\b${surface}\\b`, "i").test(text)) {
        return surface[0].toUpperCase() + surface.slice(1);
      }
    }
    return null;
  }

  function rankDataFromMatched(matched, row) {
    const tour = utils.tour(row);
    const homeRank = rankingPosition(matched?.主場365競賽者, tour);
    const awayRank = rankingPosition(matched?.客場365競賽者, tour);
    return {
      主場排名: homeRank,
      客場排名: awayRank,
      主場排名來源: homeRank !== null ? "365Scores_day" : null,
      客場排名來源: awayRank !== null ? "365Scores_day" : null
    };
  }

  function detailCompetitor(payload, gameSide, competitorId) {
    const detailGame = payload?.game && typeof payload.game === "object"
      ? payload.game
      : payload;
    const fromGame = detailGame?.[gameSide] && typeof detailGame[gameSide] === "object"
      ? detailGame[gameSide]
      : {};
    const index = competitorIndex(payload);
    const id = utils.finiteNumber(fromGame?.id ?? competitorId);
    const fromIndex = id !== null ? index.get(Number(id)) : null;
    return fromIndex && typeof fromIndex === "object"
      ? { ...fromIndex, ...fromGame }
      : fromGame;
  }

  async function fetchMatchDetail(workerUrl, matched, row) {
    const game = matched?.game || {};
    const home = game.homeCompetitor && typeof game.homeCompetitor === "object"
      ? game.homeCompetitor
      : {};
    const away = game.awayCompetitor && typeof game.awayCompetitor === "object"
      ? game.awayCompetitor
      : {};
    const identifiers = [game.id, game.competitionId, home.id, away.id];
    if (identifiers.some(value => value === null || value === undefined)) {
      throw new Error("365Scores場次缺少ID。");
    }

    const base = normalizeBaseUrl(workerUrl);
    const matchupId = `${away.id}-${home.id}-${game.competitionId}`;
    const response = await fetch(
      `${base}/source/365/game?gameId=${encodeURIComponent(game.id)}` +
      `&matchupId=${encodeURIComponent(matchupId)}&v=${Date.now()}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      const detail = await responseDetail(response, "365Scores場次明細讀取失敗");
      throw new Error(`365Scores HTTP ${response.status}：${detail}`);
    }

    const payload = await response.json();
    const detailGame = payload?.game && typeof payload.game === "object"
      ? payload.game
      : payload;
    const displayName =
      detailGame?.competitionDisplayName ||
      game.competitionDisplayName ||
      matched.competition;
    const gameHome = detailCompetitor(payload, "homeCompetitor", home.id);
    const gameAway = detailCompetitor(payload, "awayCompetitor", away.id);
    const sourceHome = matched.reversedPair ? gameAway : gameHome;
    const sourceAway = matched.reversedPair ? gameHome : gameAway;
    const tour = utils.tour(row);
    const homeRank = rankingPosition(sourceHome, tour);
    const awayRank = rankingPosition(sourceAway, tour);

    return {
      payload,
      source: "365Scores",
      surface: surfaceText(displayName),
      game_id: game.id,
      competitionDisplayName: displayName,
      match_score: matched.score,
      主場排名: homeRank,
      客場排名: awayRank,
      主場排名來源: homeRank !== null ? "365Scores_game" : null,
      客場排名來源: awayRank !== null ? "365Scores_game" : null
    };
  }

  async function resolveMatchData(workerUrl, row, snapshots, options = {}) {
    const matched = match(row, snapshots);
    if (!matched) {
      return {
        source: "365Scores",
        surface: null,
        主場排名: null,
        客場排名: null,
        match_status: "match_unmatched"
      };
    }

    const dayRank = rankDataFromMatched(matched, row);
    const daySurface = surfaceText(
      matched.game?.competitionDisplayName || matched.competition
    );
    const needDetail = options.fetchDetail !== false && (
      options.requireSurface === true ||
      dayRank.主場排名 === null ||
      dayRank.客場排名 === null
    );

    if (!needDetail) {
      return {
        source: "365Scores",
        surface: daySurface,
        game_id: matched.game?.id ?? null,
        competitionDisplayName:
          matched.game?.competitionDisplayName || matched.competition,
        match_score: matched.score,
        主場365姓名: matched.主場365姓名,
        客場365姓名: matched.客場365姓名,
        ...dayRank,
        match_status: "matched_day"
      };
    }

    try {
      const detail = await fetchMatchDetail(workerUrl, matched, row);
      return {
        ...detail,
        主場365姓名: matched.主場365姓名,
        客場365姓名: matched.客場365姓名,
        主場排名: detail.主場排名 ?? dayRank.主場排名,
        客場排名: detail.客場排名 ?? dayRank.客場排名,
        主場排名來源:
          detail.主場排名來源 ?? dayRank.主場排名來源,
        客場排名來源:
          detail.客場排名來源 ?? dayRank.客場排名來源,
        surface: detail.surface || daySurface,
        match_status: "matched"
      };
    } catch (error) {
      return {
        source: "365Scores",
        surface: daySurface,
        game_id: matched.game?.id ?? null,
        competitionDisplayName:
          matched.game?.competitionDisplayName || matched.competition,
        match_score: matched.score,
        主場365姓名: matched.主場365姓名,
        客場365姓名: matched.客場365姓名,
        ...dayRank,
        match_status: "detail_request_failed",
        error: `${error?.name || "Error"}: ${error?.message || String(error)}`
      };
    }
  }

  async function fetchSurface(workerUrl, matched, row = {}) {
    return fetchMatchDetail(workerUrl, matched, row);
  }

  async function resolveSurface(workerUrl, row, snapshots) {
    return resolveMatchData(workerUrl, row, snapshots, {
      requireSurface: true
    });
  }

  return {
    fetchDay,
    names,
    validRank,
    rankingPosition,
    competitorIndex,
    match,
    surfaceText,
    rankDataFromMatched,
    fetchMatchDetail,
    fetchSurface,
    resolveMatchData,
    resolveSurface
  };
});


/* ============================================================
   tennisratio.js｜TennisRatio 統計、排名補位與限流
   ============================================================ */
(function (root, factory) {
  const utils = typeof module === "object" && module.exports
    ? require("./source-utils.js")
    : root.TennisRatioSourceUtils;
  const api = factory(utils);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TennisRatioDataSource = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (utils) {
  "use strict";

  if (!utils) throw new Error("source-utils.js 尚未載入。");

  const BASE_URL = "https://www.tennisratio.com";
  const SURFACES = new Set(["hard", "clay", "grass"]);
  const ROUND_WORDS = [
    "Final", "Semifinal", "Quarterfinal", "Round of 128", "Round of 64",
    "Round of 32", "Round of 16", "First Round", "Second Round", "Third Round"
  ];
  const requestCache = new Map();
  const REQUEST_MIN_INTERVAL_MS = 450;
  const RATE_LIMIT_BACKOFF_MS = [10000, 25000, 60000];
  let requestSerial = Promise.resolve();
  let lastRequestAt = 0;
  let cooldownUntil = 0;

  function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  function stableRequestUrl(value) {
    const url = new URL(String(value || ""));
    url.searchParams.delete("v");
    return url.toString();
  }

  function queueRequest(task) {
    const current = requestSerial
      .catch(() => undefined)
      .then(task);
    requestSerial = current.catch(() => undefined);
    return current;
  }

  function responseMessage(text, fallback) {
    try {
      const payload = JSON.parse(String(text || ""));
      return payload.error || payload.detail || payload.message || fallback;
    } catch {
      return String(text || "").trim() || fallback;
    }
  }

  function rateLimitedResponse(status, text) {
    return status === 429 || /error\s*code\s*[:=]?\s*1015|rate\s*limit/i.test(
      String(text || "")
    );
  }

  async function throttledTextRequest(url) {
    return queueRequest(async () => {
      for (let attempt = 0; attempt <= RATE_LIMIT_BACKOFF_MS.length; attempt += 1) {
        const now = Date.now();
        const spacingWait = Math.max(
          0,
          lastRequestAt + REQUEST_MIN_INTERVAL_MS - now
        );
        const cooldownWait = Math.max(0, cooldownUntil - now);
        const waitTime = Math.max(spacingWait, cooldownWait);
        if (waitTime > 0) await sleep(waitTime);

        lastRequestAt = Date.now();
        let response;
        let text;
        try {
          response = await fetch(url, { cache: "no-store" });
          text = await response.text();
        } catch (error) {
          if (attempt >= RATE_LIMIT_BACKOFF_MS.length) throw error;
          const delay = RATE_LIMIT_BACKOFF_MS[attempt];
          cooldownUntil = Date.now() + delay;
          await sleep(delay);
          continue;
        }

        if (rateLimitedResponse(response.status, text)) {
          if (attempt >= RATE_LIMIT_BACKOFF_MS.length) {
            throw new Error(
              `TennisRatio HTTP ${response.status}：${responseMessage(text, "請求受限")}`
            );
          }
          const delay = RATE_LIMIT_BACKOFF_MS[attempt];
          cooldownUntil = Date.now() + delay;
          await sleep(delay);
          continue;
        }

        if (!response.ok) {
          throw new Error(
            `TennisRatio HTTP ${response.status}：${responseMessage(text, "TennisRatio讀取失敗")}`
          );
        }

        cooldownUntil = 0;
        return text;
      }
      throw new Error("TennisRatio請求重試已用盡。");
    });
  }

  function normalizeBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  async function responseDetail(response, fallback) {
    const text = await response.text();
    try {
      const payload = JSON.parse(text);
      return payload.error || payload.detail || payload.message || fallback;
    } catch {
      return text || fallback;
    }
  }

  async function fetchText(url) {
    const cacheKey = `text:${stableRequestUrl(url)}`;
    if (requestCache.has(cacheKey)) {
      return requestCache.get(cacheKey);
    }
    const promise = throttledTextRequest(url);
    requestCache.set(cacheKey, promise);
    try {
      return await promise;
    } catch (error) {
      requestCache.delete(cacheKey);
      throw error;
    }
  }

  async function fetchJson(url) {
    const cacheKey = `json:${stableRequestUrl(url)}`;
    if (requestCache.has(cacheKey)) {
      return requestCache.get(cacheKey);
    }
    const promise = throttledTextRequest(url).then(text => {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("TennisRatio球員統計不是有效JSON。");
      }
    });
    requestCache.set(cacheKey, promise);
    try {
      return await promise;
    } catch (error) {
      requestCache.delete(cacheKey);
      throw error;
    }
  }

  function displayFromSlug(slug) {
    return String(slug || "")
      .split("-")
      .filter(Boolean)
      .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function playerIdFromName(name) {
    return (utils.stripDiacritics(name).match(/[A-Za-z0-9]+/g) || [])
      .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join("");
  }

  function compactText(element) {
    return String(element?.innerText || element?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseHtml(htmlText) {
    if (typeof DOMParser === "undefined") {
      throw new Error("目前環境沒有 DOMParser，TennisRatio HTML 只能在瀏覽器解析。");
    }
    return new DOMParser().parseFromString(String(htmlText || ""), "text/html");
  }

  function findCard(anchor) {
    let fallback = anchor?.parentElement || anchor;
    let parent = anchor?.parentElement;
    while (parent) {
      const text = compactText(parent);
      if (text.length > 1800) break;
      if (/\bVS\b/i.test(text) && text.includes("Rank:")) return parent;
      fallback = parent;
      parent = parent.parentElement;
    }
    return fallback;
  }

  function extractRankValues(text) {
    const values = [];
    const pattern = /Rank\s*:\s*(\d+|N\/?A|—|-)/gi;
    for (const match of String(text || "").matchAll(pattern)) {
      values.push(/^\d+$/.test(match[1]) ? Number(match[1]) : null);
    }
    return values;
  }

  function extractProfileIds(card) {
    const result = [];
    for (const link of card?.querySelectorAll?.("a[href]") || []) {
      const href = String(link.getAttribute("href") || "");
      if (href.includes("h2h-compare")) continue;
      const match = href.match(
        /\/(?:players?|player)\/(?:profile\/)?([^/?#]+?)(?:\.html)?(?:[?#]|$)/i
      );
      if (!match) continue;
      const candidate = match[1].replace(/[^A-Za-z0-9]/g, "");
      if (candidate && !result.includes(candidate)) result.push(candidate);
    }
    return result;
  }

  function extractExactNames(card, slugNames) {
    const slugNorms = new Set(slugNames.map(utils.normalize));
    const candidates = [];
    const seen = new Set();
    for (const element of card?.querySelectorAll?.("a,span,div,strong,img") || []) {
      const raw = String(
        element.tagName === "IMG"
          ? element.getAttribute("alt") || ""
          : element.textContent || ""
      ).replace(/\s+/g, " ").trim();
      if (
        !raw || raw.length > 60 ||
        /^rank/i.test(raw) || /^match preview/i.test(raw) || /^VS$/i.test(raw)
      ) continue;
      const normalized = utils.normalize(raw);
      if (slugNorms.has(normalized) && !seen.has(normalized)) {
        candidates.push(raw);
        seen.add(normalized);
      }
      if (candidates.length === 2) break;
    }
    return candidates.length === 2 ? candidates : slugNames;
  }

  function parseSurface(text) {
    const lowered = String(text || "").toLocaleLowerCase("en-US");
    for (const surface of SURFACES) {
      if (new RegExp(`\\b${surface}\\b`, "i").test(lowered)) {
        return surface.slice(0, 1).toUpperCase() + surface.slice(1);
      }
    }
    return null;
  }

  function parseTourLevel(text, tourPage) {
    const lowered = String(text || "").toLocaleLowerCase("en-US");
    const futures =
      lowered.includes("futures") ||
      /\bitf\b|\bw\d{2,3}\b|\bm\d{2,3}\b/i.test(lowered);
    const challenger =
      lowered.includes("challenger") ||
      lowered.includes("challengers") ||
      (tourPage === "WTA" && /\b125\s*k?\b/i.test(lowered));
    if (futures) return ["ITF/Futures", challenger, true];
    if (challenger) return [tourPage === "ATP" ? "ATP Challenger" : "WTA 125", true, false];
    if (
      lowered.includes("grand slam") ||
      ["wimbledon", "roland garros", "us open", "australian open"]
        .some(name => lowered.includes(name))
    ) return ["Grand Slam", false, false];
    return [tourPage, false, false];
  }

  function tournamentHeaderCandidate(text) {
    return (
      text && text.length <= 350 &&
      parseSurface(text) &&
      /\b(ATP|WTA|Challengers?|Futures|Grand Slam)\b/i.test(text)
    );
  }

  function findTournamentContext(anchor, tourPage, documentRoot) {
    const card = findCard(anchor);
    let header = "";
    const elements = [...documentRoot.querySelectorAll("body *")];
    const index = elements.indexOf(card);
    if (index >= 0) {
      let inspected = 0;
      for (let cursor = index - 1; cursor >= 0 && inspected < 120; cursor -= 1) {
        const element = elements[cursor];
        if (card.contains(element)) continue;
        inspected += 1;
        const text = compactText(element);
        if (tournamentHeaderCandidate(text)) {
          header = text;
          break;
        }
      }
    }

    if (!header) {
      let parent = card?.parentElement;
      while (parent && !header) {
        let sibling = parent.previousElementSibling;
        while (sibling) {
          const text = compactText(sibling);
          if (tournamentHeaderCandidate(text)) {
            header = text;
            break;
          }
          sibling = sibling.previousElementSibling;
        }
        parent = parent.parentElement;
      }
    }

    header ||= tourPage;
    const surface = parseSurface(header);
    const [level] = parseTourLevel(header, tourPage);
    let tournament = header
      .replace(/\b(Hard|Clay|Grass)\b/gi, " ")
      .replace(/\b(ATP|WTA|Challengers?|Futures)\b/gi, " ")
      .replace(/^\s*(?:1000|500|250|125)\s*K?\b[\s,.:/-]*/i, "")
      .replace(
        /\b(?:Round of \d+|Quarterfinal|Semifinal|Final)\b\s*[·•-]?\s*\d+\s+matches?/gi,
        " "
      )
      .replace(/\s+/g, " ")
      .replace(/^[\s\-·]+|[\s\-·]+$/g, "");
    return {
      header,
      level,
      surface,
      tournament: tournament || null
    };
  }

  function parseScheduleHtml(htmlText, tourPage) {
    const page = String(tourPage || "").toUpperCase();
    const documentRoot = parseHtml(htmlText);
    const matches = [];
    const seen = new Set();

    for (const anchor of documentRoot.querySelectorAll('a[href*="/h2h-compare/"]')) {
      const href = String(anchor.getAttribute("href") || "");
      if (!href.includes("-vs-")) continue;
      const fullUrl = new URL(href, BASE_URL).toString();
      if (seen.has(fullUrl)) continue;
      seen.add(fullUrl);

      const slug = href
        .split("/h2h-compare/", 2)[1]
        ?.split("?", 1)[0]
        ?.replace(/\.html$/i, "");
      if (!slug || !slug.includes("-vs-")) continue;
      const [slugA, slugB] = slug.split("-vs-", 2);
      const fallbackNames = [displayFromSlug(slugA), displayFromSlug(slugB)];
      const card = findCard(anchor);
      const [playerA, playerB] = extractExactNames(card, fallbackNames);
      const ranks = extractRankValues(compactText(card));
      const profileIds = extractProfileIds(card);
      const cardText = compactText(card);
      const dateMatch = cardText.match(/\b(\d{2}\.\d{2}\.)\b/);
      const timeMatch = cardText.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/);
      let round = ROUND_WORDS.find(word =>
        cardText.toLocaleLowerCase("en-US").includes(word.toLocaleLowerCase("en-US"))
      ) || null;
      const context = findTournamentContext(anchor, page, documentRoot);
      if (!round) {
        round = ROUND_WORDS.find(word =>
          context.header.toLocaleLowerCase("en-US")
            .includes(word.toLocaleLowerCase("en-US"))
        ) || null;
      }
      const lowerHeader = context.header.toLocaleLowerCase("en-US");
      const isQualifying = ["qualies", "qualifying", "qualification"]
        .some(token => lowerHeader.includes(token));
      const [parsedLevel, isChallenger, isFutures] = parseTourLevel(context.header, page);

      matches.push({
        tour_page: page,
        tour_type: page,
        tournament_level: parsedLevel || context.level,
        tournament_name: context.tournament,
        tournament_header: context.header,
        surface: context.surface,
        round_name: round,
        date_text: dateMatch?.[1] || null,
        time_text: timeMatch?.[0] || null,
        player_a: playerA,
        player_b: playerB,
        player_a_rank: ranks[0] ?? null,
        player_b_rank: ranks[1] ?? null,
        player_a_id: profileIds[0] || playerIdFromName(playerA),
        player_b_id: profileIds[1] || playerIdFromName(playerB),
        h2h_url: fullUrl,
        is_qualifying: isQualifying,
        is_challenger: isChallenger,
        is_futures: isFutures
      });
    }
    return matches;
  }

  async function fetchSchedule(workerUrl, tour) {
    const page = String(tour || "").toUpperCase();
    if (!new Set(["ATP", "WTA"]).has(page)) {
      throw new Error("tour只能是ATP或WTA。");
    }
    const base = normalizeBaseUrl(workerUrl);
    const html = await fetchText(
      `${base}/source/tennisratio/schedule?tour=${encodeURIComponent(page)}&v=${Date.now()}`
    );
    const parsed = parseScheduleHtml(html, page);
    if (!parsed.length) {
      throw new Error(`${page}賽程HTML已取得，但沒有解析出任何H2H對陣。`);
    }
    return parsed;
  }

  async function fetchPlayerStats(workerUrl, playerId, surface, level) {
    const surfaceValue = String(surface || "").toLocaleLowerCase("en-US");
    const levelValue = String(level || "").toLocaleLowerCase("en-US");
    if (!SURFACES.has(surfaceValue)) throw new Error(`不支援的場地：${surface}`);
    if (!new Set(["all", "main"]).has(levelValue)) {
      throw new Error(`不支援的層級參數：${level}`);
    }
    const base = normalizeBaseUrl(workerUrl);
    const data = await fetchJson(
      `${base}/source/tennisratio/stats?playerId=${encodeURIComponent(playerId)}` +
      `&surface=${encodeURIComponent(surfaceValue)}&level=${encodeURIComponent(levelValue)}` +
      `&v=${Date.now()}`
    );
    if (!data || typeof data !== "object" || !data.stats || typeof data.stats !== "object") {
      throw new Error(`球員統計格式異常：${playerId}/${surfaceValue}/${levelValue}`);
    }
    return data;
  }

  function currentRank(text) {
    const compact = String(text || "").replace(/\s+/g, " ");
    const patterns = [
      /\b(?:ATP|WTA)\s*#\s*(\d{1,4})\b/i,
      /\bCurrent\s+(?:World\s+)?Rank(?:ing)?\s*:?\s*#?\s*(\d{1,4})\b/i,
      /\bWorld\s+Rank(?:ing)?\s*:?\s*#?\s*(\d{1,4})\b/i,
      /\bRank\s*:?\s*#\s*(\d{1,4})\b/i
    ];
    for (const pattern of patterns) {
      const match = compact.match(pattern);
      if (match) return Number(match[1]);
    }
    return null;
  }

  function profileName(htmlText) {
    const documentRoot = parseHtml(htmlText);
    for (const selector of ["h1", ".player-name", "[class*='player-name']", "title"]) {
      const element = documentRoot.querySelector(selector);
      let value = compactText(element);
      if (value) {
        value = value.replace(/\s*[|–-].*$/, "").trim();
        if (value) return value;
      }
    }
    return "";
  }

  async function fetchPlayerProfileRank(workerUrl, playerId, expectedName) {
    const id = String(playerId || "").replace(/[^A-Za-z0-9]/g, "");
    if (!id) throw new Error(`球員Profile ID為空：${expectedName}`);
    const base = normalizeBaseUrl(workerUrl);
    const html = await fetchText(
      `${base}/source/tennisratio/profile?playerId=${encodeURIComponent(id)}&v=${Date.now()}`
    );
    const documentRoot = parseHtml(html);
    const pageText = compactText(documentRoot.body);
    const actualName = profileName(html) || expectedName;
    if (!utils.compatibleName(expectedName, actualName)) {
      throw new Error(`球員Profile身分不符：頁面為${actualName || "未知球員"}，預期${expectedName}`);
    }
    const rank = currentRank(pageText);
    if (rank === null) {
      throw new Error(`球員Profile找不到目前排名：${actualName}`);
    }
    return {
      name: actualName,
      player_id: id,
      rank,
      rank_source: "player_profile",
      profile_url: `${BASE_URL}/players/${encodeURIComponent(id)}.html`
    };
  }

  function profileLinks(htmlText) {
    const documentRoot = parseHtml(htmlText);
    const found = [];
    const seen = new Set();
    for (const link of documentRoot.querySelectorAll("a[href]")) {
      const href = String(link.getAttribute("href") || "");
      const match = href.match(
        /\/(?:players?|player)\/(?:profile\/)?([^/?#]+?)(?:\.html)?(?:[?#]|$)/i
      );
      if (!match) continue;
      const playerId = match[1].replace(/[^A-Za-z0-9]/g, "");
      if (!playerId || seen.has(playerId)) continue;
      seen.add(playerId);
      found.push([compactText(link), playerId]);
    }
    return found;
  }

  async function directoryPlayerIds(workerUrl, playerName, tour) {
    const base = normalizeBaseUrl(workerUrl);
    const pages = ["ALL"];
    if (new Set(["ATP", "WTA"]).has(String(tour || "").toUpperCase())) {
      pages.push(String(tour).toUpperCase());
    }
    const scored = [];
    const seen = new Set();
    for (const page of pages) {
      try {
        const html = await fetchText(
          `${base}/source/tennisratio/directory?tour=${encodeURIComponent(page)}&v=${Date.now()}`
        );
        for (const [label, playerId] of profileLinks(html)) {
          if (seen.has(playerId)) continue;
          const score = Math.max(
            utils.similarity(playerName, label || playerId),
            utils.similarity(playerName, playerId)
          );
          if (utils.compatibleName(playerName, label || playerId) || score >= 0.82) {
            seen.add(playerId);
            scored.push([score, playerId]);
          }
        }
      } catch {
        // Directory is only the last fallback.
      }
    }
    scored.sort((left, right) => right[0] - left[0]);
    return scored.slice(0, 5).map(item => item[1]);
  }

  function validRank(value) {
    const rank = Number(value);
    return Number.isInteger(rank) && rank > 0 ? rank : null;
  }

  function scheduleIdentity(playerName, schedules) {
    const matches = [];
    for (const item of Array.isArray(schedules) ? schedules : []) {
      for (const side of ["a", "b"]) {
        const officialName = String(item?.[`player_${side}`] || "");
        const playerId = String(item?.[`player_${side}_id`] || "");
        const scheduleRank = validRank(item?.[`player_${side}_rank`]);
        const score = utils.similarity(playerName, officialName);
        if (utils.compatibleName(playerName, officialName) || score >= 0.88) {
          matches.push([
            score,
            officialName,
            playerId,
            item.h2h_url || null,
            item.surface || null,
            scheduleRank
          ]);
        }
      }
    }
    if (!matches.length) return [null, null, null, null, null];
    matches.sort((left, right) => right[0] - left[0]);
    const best = matches[0];
    if (
      matches.length > 1 &&
      best[0] - matches[1][0] < 0.04 &&
      best[1] !== matches[1][1]
    ) return [null, null, null, null, null];
    return [best[1], best[2], best[3], best[4], best[5]];
  }

  function validStats(data) {
    return Number(data?.stats?.matches_played || 0) > 0;
  }

  function normalizedRankCandidate(candidate, fallbackSource = null) {
    const rank = validRank(candidate?.rank ?? candidate);
    if (rank === null) return null;
    return {
      rank,
      source: String(candidate?.source || fallbackSource || "unknown")
    };
  }

  function chooseRank(preferredRank, scheduleRank, profile) {
    return (
      normalizedRankCandidate(preferredRank) ||
      normalizedRankCandidate(
        scheduleRank,
        "TennisRatio_schedule"
      ) ||
      normalizedRankCandidate(
        profile?.rank,
        profile?.rank_source || "player_profile"
      )
    );
  }

  async function resolvePlayer({
    workerUrl,
    name,
    surface,
    tour,
    schedules,
    preferredRank = null
  }) {
    const [
      officialName,
      scheduleId,
      h2hUrl,
      scheduleSurface,
      scheduleRank
    ] = scheduleIdentity(name, schedules);
    const effectiveSurface = String(
      surface || scheduleSurface || ""
    ).toLocaleLowerCase("en-US") || null;
    const expectedNames = [officialName, name]
      .map(value => String(value || "").trim())
      .filter(Boolean);
    const candidateIds = [];

    function addCandidate(value, source) {
      const candidate = String(value || "")
        .replace(/[^A-Za-z0-9]/g, "");
      if (
        candidate &&
        !candidateIds.some(item => item[0] === candidate)
      ) {
        candidateIds.push([candidate, source]);
      }
    }

    addCandidate(scheduleId, "schedule_player_id");
    for (const candidateName of expectedNames) {
      addCandidate(
        playerIdFromName(candidateName),
        "name_generated_id"
      );
    }

    const errors = [];

    async function tryCandidates(candidates) {
      for (const [playerId, resolutionSource] of candidates) {
        let allData = null;
        let mainData = null;
        let profile = null;
        let actualName = officialName || name;

        if (SURFACES.has(effectiveSurface)) {
          // 嚴格依序讀取 All Levels 與 Main Tour，
          // 不再使用 Promise.all 同時撞 TennisRatio。
          for (const level of ["all", "main"]) {
            try {
              const data = await fetchPlayerStats(
                workerUrl,
                playerId,
                effectiveSurface,
                level
              );
              const returnedName = String(
                data.player_name || data.name || ""
              ).trim();
              if (
                returnedName &&
                !expectedNames.some(expected =>
                  utils.compatibleName(expected, returnedName)
                )
              ) {
                errors.push(
                  `${playerId}/${level}回傳${returnedName}，與${name}不相容`
                );
                continue;
              }
              actualName = returnedName || actualName;
              if (level === "all") allData = data;
              else mainData = data;
            } catch (error) {
              errors.push(error?.message || String(error));
            }
          }
        }

        let selectedRank = chooseRank(
          preferredRank,
          scheduleRank,
          null
        );

        // 只有365Scores與TennisRatio賽程都沒有排名時，
        // 才低速請求Profile作最後備援。
        if (!selectedRank) {
          try {
            profile = await fetchPlayerProfileRank(
              workerUrl,
              playerId,
              actualName
            );
            actualName = profile.name || actualName;
            selectedRank = chooseRank(
              preferredRank,
              scheduleRank,
              profile
            );
          } catch (error) {
            errors.push(error?.message || String(error));
          }
        }

        const allValid = validStats(allData || {});
        const mainValid = validStats(mainData || {});
        if (!allValid && !mainValid && !profile) continue;
        const statsFound = allValid || mainValid;
        const rankFound = Boolean(selectedRank);
        let dataStatus = "partial";
        if (allValid && mainValid && rankFound) {
          dataStatus = "complete";
        } else if (statsFound && !rankFound) {
          dataStatus = "rank_missing";
        } else if (!statsFound && rankFound) {
          dataStatus = "stats_missing";
        }

        return {
          found: true,
          identity_found: true,
          stats_found: statsFound,
          rank_found: rankFound,
          Pinnacle姓名: name,
          正式姓名: actualName,
          player_id: playerId,
          rank: selectedRank?.rank ?? null,
          rank_source: selectedRank?.source ?? null,
          rank_candidates: {
            "365Scores": normalizedRankCandidate(preferredRank)?.rank ?? null,
            TennisRatio_schedule: validRank(scheduleRank),
            TennisRatio_profile: validRank(profile?.rank)
          },
          profile_url:
            profile?.profile_url ||
            `${BASE_URL}/players/${encodeURIComponent(playerId)}.html`,
          h2h_url: h2hUrl,
          surface: effectiveSurface,
          all_surface: allValid ? allData : {},
          main_surface: mainValid ? mainData : {},
          all_surface_sample_valid: allValid,
          main_surface_sample_valid: mainValid,
          resolution_source: resolutionSource,
          data_status: dataStatus,
          errors: errors.slice(-8)
        };
      }
      return null;
    }

    let resolved = await tryCandidates(candidateIds);
    if (resolved) return resolved;

    // Directory 是最後的球員ID備援，不再為每位球員預先請求。
    const previousLength = candidateIds.length;
    for (const playerId of await directoryPlayerIds(
      workerUrl,
      name,
      tour
    )) {
      addCandidate(playerId, "player_directory");
    }
    resolved = await tryCandidates(
      candidateIds.slice(previousLength)
    );
    if (resolved) return resolved;

    const fallbackRank = chooseRank(
      preferredRank,
      scheduleRank,
      null
    );
    return {
      found: false,
      identity_found: Boolean(officialName),
      stats_found: false,
      rank_found: Boolean(fallbackRank),
      Pinnacle姓名: name,
      正式姓名: officialName || name,
      player_id: scheduleId || null,
      rank: fallbackRank?.rank ?? null,
      rank_source: fallbackRank?.source ?? null,
      rank_candidates: {
        "365Scores": normalizedRankCandidate(preferredRank)?.rank ?? null,
        TennisRatio_schedule: validRank(scheduleRank),
        TennisRatio_profile: null
      },
      profile_url: scheduleId
        ? `${BASE_URL}/players/${encodeURIComponent(scheduleId)}.html`
        : null,
      h2h_url: h2hUrl,
      surface: effectiveSurface,
      all_surface: {},
      main_surface: {},
      all_surface_sample_valid: false,
      main_surface_sample_valid: false,
      resolution_source: null,
      data_status: fallbackRank
        ? "stats_missing"
        : "not_found",
      errors: errors.slice(-10)
    };
  }

  function scheduleSurface(row, schedule) {
    const target = utils.tournamentName(row);
    const targetNormalized = utils.normalize(target);
    const targetLevel = utils.tournamentLevel(row?.["聯賽"]);
    const targetRound = utils.roundName(row?.["聯賽"]);
    const baseResult = {
      source: "TennisRatio賽程",
      Pinnacle聯賽: row?.["聯賽"],
      Pinnacle賽事名稱: target || null,
      Pinnacle層級: targetLevel,
      Pinnacle輪次: targetRound,
      matching_policy:
        "只比對巡迴、聯賽賽事名稱與層級；輪次只紀錄、不參與場地判定；不比對選手與時間"
    };
    if (!targetNormalized) {
      return { ...baseResult, surface: null, match_status: "tournament_name_missing" };
    }
    if (!new Set(["ATP Challenger", "WTA 125"]).has(targetLevel)) {
      return { ...baseResult, surface: null, match_status: "unsupported_tournament_level" };
    }

    const candidates = [];
    for (const item of Array.isArray(schedule) ? schedule : []) {
      if (item.tournament_level !== targetLevel) continue;
      const itemRound = utils.canonicalRound(item.round_name || item.tournament_header);
      const names = [item.tournament_name, item.tournament_header]
        .map(value => String(value || ""))
        .filter(Boolean);
      const normalizedNames = names.map(utils.normalize);
      if (!normalizedNames.some(candidate =>
        candidate && (
          targetNormalized === candidate ||
          targetNormalized.includes(candidate) ||
          candidate.includes(targetNormalized)
        )
      )) continue;
      const surface = String(item.surface || "");
      if (!utils.SURFACES.has(surface)) continue;
      const exact = normalizedNames.some(candidate => candidate === targetNormalized) ? 1 : 0;
      const gap = Math.min(
        ...normalizedNames.filter(Boolean)
          .map(candidate => Math.abs(candidate.length - targetNormalized.length)),
        999
      );
      const roundMatches = targetRound && itemRound === targetRound ? 1 : 0;
      candidates.push({ exact, roundMatches, gap, item, surface, itemRound });
    }

    if (!candidates.length) {
      return {
        ...baseResult,
        surface: null,
        match_status: "league_level_tournament_unmatched"
      };
    }
    const candidateSurfaces = [...new Set(candidates.map(item => item.surface))].sort();
    if (candidateSurfaces.length !== 1) {
      return {
        ...baseResult,
        surface: null,
        candidate_count: candidates.length,
        candidate_surfaces: candidateSurfaces,
        match_status: "league_level_tournament_surface_conflict"
      };
    }
    candidates.sort((left, right) =>
      right.exact - left.exact ||
      right.roundMatches - left.roundMatches ||
      left.gap - right.gap
    );
    const selected = candidates[0];
    return {
      ...baseResult,
      surface: candidateSurfaces[0],
      TennisRatio賽事名稱: selected.item.tournament_name,
      TennisRatio賽事標題: selected.item.tournament_header,
      TennisRatio層級: selected.item.tournament_level,
      TennisRatio輪次: selected.itemRound,
      輪次是否相同: targetRound ? selected.itemRound === targetRound : null,
      輪次參與場地判定: false,
      candidate_count: candidates.length,
      candidate_surfaces: candidateSurfaces,
      match_status: "league_level_tournament_matched"
    };
  }

  function stats(player, key) {
    const data = player?.[key] && typeof player[key] === "object" ? player[key] : {};
    return { ...(data.stats || {}) };
  }

  return {
    BASE_URL,
    displayFromSlug,
    playerIdFromName,
    parseScheduleHtml,
    fetchSchedule,
    fetchPlayerStats,
    fetchPlayerProfileRank,
    directoryPlayerIds,
    scheduleIdentity,
    resolvePlayer,
    scheduleSurface,
    stats,
    profileName,
    currentRank,
    validRank,
    validStats,
    normalizedRankCandidate,
    chooseRank,
    REQUEST_MIN_INTERVAL_MS,
    RATE_LIMIT_BACKOFF_MS,
    clearMemoryCache: () => {
      requestCache.clear();
      requestSerial = Promise.resolve();
      lastRequestAt = 0;
      cooldownUntil = 0;
    }
  };
});


/* ============================================================
   source-pipeline.js｜外部資料整合流程
   ============================================================ */
(function (root, factory) {
  const utils = typeof module === "object" && module.exports
    ? require("./source-utils.js")
    : root.TennisRatioSourceUtils;
  const scores365 = typeof module === "object" && module.exports
    ? require("./scores365.js")
    : root.TennisRatioScores365;
  const tennisratio = typeof module === "object" && module.exports
    ? require("./tennisratio.js")
    : root.TennisRatioDataSource;
  const api = factory(utils, scores365, tennisratio);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TennisRatioSourcePipeline = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  utils,
  scores365,
  tennisratio
) {
  "use strict";

  if (!utils || !scores365 || !tennisratio) {
    throw new Error("Phase 3資料來源模組尚未完整載入。");
  }

  function progress(callback, message, detail = {}) {
    if (typeof callback === "function") callback(message, detail);
  }

  async function mapWithConcurrency(items, concurrency, mapper) {
    const source = Array.isArray(items) ? items : [];
    const results = new Array(source.length);
    let cursor = 0;

    async function worker() {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= source.length) return;
        results[index] = await mapper(source[index], index);
      }
    }

    await Promise.all(
      Array.from(
        {
          length: Math.max(
            1,
            Math.min(Number(concurrency) || 1, source.length || 1)
          )
        },
        worker
      )
    );
    return results;
  }

  function dateKeyFromRow(row) {
    const parsed = utils.parseTaipeiDateTime(row?.["日期時間"]);
    if (!parsed) return null;
    return utils.taipeiDateText(parsed)?.slice(0, 10) || null;
  }

  async function loadSurfaceSources(workerUrl, rows, callback) {
    // 365Scores 現在不只負責主巡迴場地，也負責 ATP/WTA 排名。
    // 因此所有場次日期都必須載入，不再排除 Challenger／WTA 125。
    const dates = [...new Set(
      rows.map(dateKeyFromRow).filter(Boolean)
    )].sort();

    const scoreSnapshots = [];
    const scoreErrors = {};
    for (const dateKey of dates) {
      progress(
        callback,
        `正在讀取365比分網 ${dateKey} 場地與ATP／WTA排名……`,
        {
          stage: "365_day",
          date: dateKey
        }
      );
      try {
        scoreSnapshots.push(
          await scores365.fetchDay(
            workerUrl,
            `${dateKey}T00:00:00+08:00`
          )
        );
      } catch (error) {
        scoreErrors[dateKey] =
          `${error?.name || "Error"}: ${error?.message || String(error)}`;
      }
    }

    const neededTours = new Set(rows.map(utils.tour).filter(Boolean));
    const schedules = { ATP: [], WTA: [] };
    const scheduleErrors = {};
    for (const tourName of ["ATP", "WTA"]) {
      if (!neededTours.has(tourName)) continue;
      progress(
        callback,
        `正在讀取TennisRatio ${tourName}賽程、場地、球員識別與備援排名……`,
        {
          stage: "tennisratio_schedule",
          tour: tourName
        }
      );
      try {
        schedules[tourName] = await tennisratio.fetchSchedule(
          workerUrl,
          tourName
        );
      } catch (error) {
        scheduleErrors[tourName] =
          `${error?.name || "Error"}: ${error?.message || String(error)}`;
      }
    }
    return {
      scoreSnapshots,
      schedules,
      scoreErrors,
      scheduleErrors
    };
  }

  function validRankCandidate(rank, source) {
    const value = Number(rank);
    if (!Number.isInteger(value) || value <= 0) return null;
    return {
      rank: value,
      source: String(source || "unknown")
    };
  }

  function emptyPlayer(name, surface, errors = [], rankCandidate = null) {
    const preferred = validRankCandidate(
      rankCandidate?.rank,
      rankCandidate?.source
    );
    return {
      found: false,
      identity_found: false,
      stats_found: false,
      rank_found: Boolean(preferred),
      Pinnacle姓名: name,
      正式姓名: name,
      player_id: null,
      rank: preferred?.rank ?? null,
      rank_source: preferred?.source ?? null,
      profile_url: null,
      h2h_url: null,
      surface: surface || null,
      all_surface: {},
      main_surface: {},
      all_surface_sample_valid: false,
      main_surface_sample_valid: false,
      resolution_source: null,
      data_status: preferred ? "identity_missing" : "not_found",
      errors: errors.slice(-8)
    };
  }

  function preferredRankFrom365(scoreInfo, side) {
    const prefix = side === "home" ? "主場" : "客場";
    return validRankCandidate(
      scoreInfo?.[`${prefix}排名`],
      scoreInfo?.[`${prefix}排名來源`] || "365Scores"
    );
  }

  async function enrichOne(workerUrl, row, sourceState) {
    const rowTour = utils.tour(row);
    const playerSchedule = rowTour
      ? sourceState.schedules[rowTour] || []
      : [
          ...(sourceState.schedules.ATP || []),
          ...(sourceState.schedules.WTA || [])
        ];

    const scheduleOwnsSurface =
      utils.usesTennisRatioScheduleSurface(row);

    // 每場只做一次 365Scores 配對。
    // 主巡迴需要它的場地；所有層級都使用它的排名。
    const scoreInfo = await scores365.resolveMatchData(
      workerUrl,
      row,
      sourceState.scoreSnapshots,
      {
        requireSurface: !scheduleOwnsSurface,
        fetchDetail: true
      }
    );

    let surfaceInfo;
    let surfaceSource;
    const sourceFields = {
      "365Scores": { ...scoreInfo },
      "TennisRatio賽事場地": {}
    };

    if (scheduleOwnsSurface) {
      surfaceInfo = tennisratio.scheduleSurface(
        row,
        sourceState.schedules[rowTour] || []
      );
      surfaceSource = "TennisRatio賽程";
      sourceFields["TennisRatio賽事場地"] = {
        ...surfaceInfo
      };
    } else {
      surfaceInfo = scoreInfo;
      surfaceSource = "365Scores";
    }

    const surface = String(surfaceInfo?.surface || "");
    const surfaceKey = new Set(["hard", "clay", "grass"])
      .has(surface.toLocaleLowerCase("en-US"))
      ? surface.toLocaleLowerCase("en-US")
      : null;

    const names = [
      String(row?.["主場"] || ""),
      String(row?.["客場"] || "")
    ];
    const homePreferredRank = preferredRankFrom365(
      scoreInfo,
      "home"
    );
    const awayPreferredRank = preferredRankFrom365(
      scoreInfo,
      "away"
    );

    // TennisRatio 使用嚴格單線限流：
    // 每次只處理一位球員，不再同時打主客場請求。
    let homePlayer;
    let awayPlayer;

    try {
      homePlayer = await tennisratio.resolvePlayer({
        workerUrl,
        name: names[0],
        surface: surfaceKey,
        tour: rowTour,
        schedules: playerSchedule,
        preferredRank: homePreferredRank
      });
    } catch (error) {
      homePlayer = emptyPlayer(
        names[0],
        surfaceKey,
        [error?.message || String(error)],
        homePreferredRank
      );
    }

    try {
      awayPlayer = await tennisratio.resolvePlayer({
        workerUrl,
        name: names[1],
        surface: surfaceKey,
        tour: rowTour,
        schedules: playerSchedule,
        preferredRank: awayPreferredRank
      });
    } catch (error) {
      awayPlayer = emptyPlayer(
        names[1],
        surfaceKey,
        [error?.message || String(error)],
        awayPreferredRank
      );
    }

    return {
      項次: row?.項次 ?? null,
      日期時間: row?.日期時間 ?? null,
      聯賽: row?.聯賽 ?? null,
      主場: row?.主場 ?? null,
      客場: row?.客場 ?? null,
      主場名次: homePlayer.rank ?? null,
      客場名次: awayPlayer.rank ?? null,
      主場賠率: row?.主場賠率 ?? null,
      客場賠率: row?.客場賠率 ?? null,
      Pinnacle比賽資訊: utils.matchInfo(row),
      比賽資訊: utils.matchInfo(row, {
        surface: surface || null,
        surfaceSource: surface ? surfaceSource : null
      }),
      ...sourceFields,
      TennisRatio: {
        場地: surface || null,
        場地來源: surface ? surfaceSource : null,
        h2h_url: utils.compareUrl(
          homePlayer.正式姓名 || row?.主場,
          awayPlayer.正式姓名 || row?.客場
        ),
        主場球員: homePlayer,
        客場球員: awayPlayer
      },
      source_status: {
        surface_resolved: Boolean(surface),
        home_player_found: Boolean(homePlayer.found),
        away_player_found: Boolean(awayPlayer.found),
        home_rank_found: Number(homePlayer.rank) > 0,
        away_rank_found: Number(awayPlayer.rank) > 0,
        both_ranks_found:
          Number(homePlayer.rank) > 0 &&
          Number(awayPlayer.rank) > 0
      }
    };
  }

  function summarize(matches) {
    const summary = {
      input_matches: matches.length,
      surface_resolved: 0,
      both_players_found: 0,
      one_or_more_players_missing: 0,
      both_ranks_found: 0,
      one_or_more_ranks_missing: 0,
      ranks_from_365scores: 0,
      ranks_from_tennisratio_schedule: 0,
      ranks_from_tennisratio_profile: 0,
      complete_players: 0,
      partial_players: 0,
      not_found_players: 0
    };

    for (const item of matches) {
      if (item?.source_status?.surface_resolved) {
        summary.surface_resolved += 1;
      }
      if (
        item?.source_status?.home_player_found &&
        item?.source_status?.away_player_found
      ) {
        summary.both_players_found += 1;
      } else {
        summary.one_or_more_players_missing += 1;
      }

      if (item?.source_status?.both_ranks_found) {
        summary.both_ranks_found += 1;
      } else {
        summary.one_or_more_ranks_missing += 1;
      }

      for (const player of [
        item?.TennisRatio?.主場球員,
        item?.TennisRatio?.客場球員
      ]) {
        const rankSource = String(player?.rank_source || "");
        if (rankSource.startsWith("365Scores")) {
          summary.ranks_from_365scores += 1;
        } else if (rankSource === "TennisRatio_schedule") {
          summary.ranks_from_tennisratio_schedule += 1;
        } else if (rankSource === "player_profile") {
          summary.ranks_from_tennisratio_profile += 1;
        }

        if (player?.data_status === "complete") {
          summary.complete_players += 1;
        } else if (
          player?.data_status === "partial" ||
          player?.data_status === "rank_missing" ||
          player?.data_status === "stats_missing"
        ) {
          summary.partial_players += 1;
        } else {
          summary.not_found_players += 1;
        }
      }
    }
    return summary;
  }

  async function buildSourceBundle(todayPayload, options = {}) {
    const workerUrl = String(options.workerUrl || "").trim();
    if (!workerUrl) throw new Error("WORKER_URL 尚未設定。");
    const rows = Array.isArray(todayPayload?.matches)
      ? todayPayload.matches.filter(
          item => item && typeof item === "object"
        )
      : [];
    const callback = options.progress;

    progress(
      callback,
      `Phase 3｜開始載入 ${rows.length} 場的365Scores排名與TennisRatio限流資料……`,
      {
        stage: "source_start",
        total: rows.length
      }
    );
    const sourceState = await loadSurfaceSources(
      workerUrl,
      rows,
      callback
    );

    let completed = 0;
    // 強制單場序列處理。即使 app.js 傳入 concurrency: 2，
    // TennisRatio 仍只會以一條請求管線執行。
    const matches = await mapWithConcurrency(
      rows,
      1,
      async row => {
        const result = await enrichOne(
          workerUrl,
          row,
          sourceState
        );
        completed += 1;
        progress(
          callback,
          `Phase 3｜限流資料 ${completed}/${rows.length}：${result.主場} vs ${result.客場}`,
          {
            stage: "source_match",
            completed,
            total: rows.length,
            item: result.項次
          }
        );
        return result;
      }
    );

    const health = summarize(matches);
    return {
      version: "3.1-rank-fallback-rate-limit",
      generated_at_taiwan: utils.isoTaipeiNow(),
      source: {
        Pinnacle: "today_matches.json 的比賽、選手與賠率",
        "365比分網":
          "ATP／WTA場地與第一順位排名（day/game competitors[].rankings[].position）",
        TennisRatio賽程:
          "ATP Challenger／WTA 125場地、球員識別與第二順位排名",
        TennisRatio球員:
          "正式姓名、All Levels與Main Tour同場地數據；Profile只作最後順位排名備援",
        TennisRatio限流:
          "單場、單球員、單請求序列執行；請求間隔與429全域冷卻由tennisratio.js控制"
      },
      rank_policy: [
        "365Scores日清單／場次明細排名",
        "TennisRatio賽程頁排名",
        "Cloudflare R2快取的TennisRatio Profile排名",
        "低速重新抓取TennisRatio Profile",
        "全部失敗才判定排名缺失"
      ],
      source_errors: {
        "365Scores": sourceState.scoreErrors,
        TennisRatio_schedule: sourceState.scheduleErrors
      },
      source_health: health,
      matches
    };
  }

  return {
    mapWithConcurrency,
    loadSurfaceSources,
    validRankCandidate,
    preferredRankFrom365,
    enrichOne,
    summarize,
    buildSourceBundle
  };
});


/* ============================================================
   r2-client.js｜Cloudflare R2 讀寫
   ============================================================ */
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

  async function uploadOddsBundle(workerUrl, uploadToken, bundle, options = {}) {
    const base = normalizeBaseUrl(workerUrl);
    const token = String(uploadToken || "").trim();
    const fullAnalysisToken = String(
      options.fullAnalysisToken || ""
    ).trim();
    if (!base) throw new Error("WORKER_URL 尚未設定。");
    if (!token) throw new Error("WORKER_UPLOAD_TOKEN 尚未填入。");
    if (!fullAnalysisToken) {
      throw new Error("完整分析啟動授權不存在，請重新輸入啟動密碼。");
    }

    const response = await fetch(`${base}/upload`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Full-Analysis-Token": fullAnalysisToken
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

  async function uploadAnalysis(workerUrl, uploadToken, analysis) {
    const base = normalizeBaseUrl(workerUrl);
    const token = String(uploadToken || "").trim();
    if (!base) throw new Error("WORKER_URL 尚未設定。");
    if (!token) throw new Error("WORKER_UPLOAD_TOKEN 尚未填入。");
    if (!analysis || !Array.isArray(analysis.matches)) {
      throw new Error("ratio_analysis 必須是含 matches 陣列的 JSON 物件。");
    }

    const response = await fetch(`${base}/upload-analysis`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ ratio_analysis: analysis }),
      cache: "no-store"
    });
    if (!response.ok) {
      const detail = await responseDetail(response, "Worker分析結果上傳失敗");
      throw new Error(`Worker HTTP ${response.status}：${detail}`);
    }
    return response.json();
  }


  async function uploadExternalRisk(
    workerUrl,
    uploadToken,
    externalRisk
  ) {
    const base = normalizeBaseUrl(workerUrl);
    const token = String(uploadToken || "").trim();

    if (!base) {
      throw new Error("WORKER_URL 尚未設定。");
    }
    if (!token) {
      throw new Error("WORKER_UPLOAD_TOKEN 尚未填入。");
    }
    if (
      !externalRisk ||
      !Array.isArray(externalRisk.entries)
    ) {
      throw new Error(
        "external_risk 必須是含 entries 陣列的 JSON 物件。"
      );
    }

    const response = await fetch(
      `${base}/upload-risk`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          external_risk: externalRisk
        }),
        cache: "no-store"
      }
    );

    if (!response.ok) {
      const detail = await responseDetail(
        response,
        "Worker 外部風險上傳失敗"
      );
      throw new Error(
        `Worker HTTP ${response.status}：${detail}`
      );
    }

    return response.json();
  }

  return {
    normalizeBaseUrl,
    fetchJson,
    uploadOddsBundle,
    uploadSourceBundle,
    uploadAnalysis,
    uploadExternalRisk
  };
});
