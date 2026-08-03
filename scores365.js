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
