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
        if (
          competition &&
          competition.toLocaleLowerCase("en-US").replace(/\s+/g, "")
            && league.toLocaleLowerCase("en-US").replace(/\s+/g, "")
              .includes(competition.toLocaleLowerCase("en-US").replace(/\s+/g, ""))
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

    const [gameHome, gameAway] = names(best.game);
    const [matchedHome, matchedAway] = best.reversedPair
      ? [gameAway, gameHome]
      : [gameHome, gameAway];
    return {
      game: best.game,
      competition: best.competition,
      score: best.score,
      pair: best.pairScore,
      主場365姓名: matchedHome,
      客場365姓名: matchedAway
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

  async function fetchSurface(workerUrl, matched) {
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
    const detail = payload?.game && typeof payload.game === "object"
      ? payload.game
      : payload;
    const displayName =
      detail?.competitionDisplayName ||
      game.competitionDisplayName ||
      matched.competition;
    return {
      source: "365Scores",
      surface: surfaceText(displayName),
      game_id: game.id,
      competitionDisplayName: displayName,
      match_score: matched.score
    };
  }

  async function resolveSurface(workerUrl, row, snapshots) {
    const matched = match(row, snapshots);
    if (!matched) {
      return {
        source: "365Scores",
        surface: null,
        match_status: "match_unmatched"
      };
    }
    try {
      return {
        ...(await fetchSurface(workerUrl, matched)),
        match_status: "matched"
      };
    } catch (error) {
      return {
        source: "365Scores",
        surface: null,
        match_status: "surface_request_failed",
        error: `${error?.name || "Error"}: ${error?.message || String(error)}`
      };
    }
  }

  return {
    fetchDay,
    names,
    match,
    surfaceText,
    fetchSurface,
    resolveSurface
  };
});
