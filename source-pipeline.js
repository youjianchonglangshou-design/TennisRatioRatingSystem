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
        { length: Math.max(1, Math.min(Number(concurrency) || 1, source.length || 1)) },
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
    const dates = [...new Set(
      rows
        .filter(row => !utils.usesTennisRatioScheduleSurface(row))
        .map(dateKeyFromRow)
        .filter(Boolean)
    )].sort();

    const scoreSnapshots = [];
    const scoreErrors = {};
    for (const dateKey of dates) {
      progress(callback, `正在讀取365比分網 ${dateKey} ATP／WTA主巡迴場地……`, {
        stage: "365_day",
        date: dateKey
      });
      try {
        scoreSnapshots.push(await scores365.fetchDay(workerUrl, `${dateKey}T00:00:00+08:00`));
      } catch (error) {
        scoreErrors[dateKey] = `${error?.name || "Error"}: ${error?.message || String(error)}`;
      }
    }

    const neededTours = new Set(rows.map(utils.tour).filter(Boolean));
    const schedules = { ATP: [], WTA: [] };
    const scheduleErrors = {};
    for (const tourName of ["ATP", "WTA"]) {
      if (!neededTours.has(tourName)) continue;
      progress(callback, `正在讀取TennisRatio ${tourName}賽程、場地與球員識別資料……`, {
        stage: "tennisratio_schedule",
        tour: tourName
      });
      try {
        schedules[tourName] = await tennisratio.fetchSchedule(workerUrl, tourName);
      } catch (error) {
        scheduleErrors[tourName] = `${error?.name || "Error"}: ${error?.message || String(error)}`;
      }
    }
    return { scoreSnapshots, schedules, scoreErrors, scheduleErrors };
  }

  function emptyPlayer(name, surface, errors = []) {
    return {
      found: false,
      Pinnacle姓名: name,
      正式姓名: name,
      player_id: null,
      rank: null,
      rank_source: null,
      profile_url: null,
      h2h_url: null,
      surface: surface || null,
      all_surface: {},
      main_surface: {},
      all_surface_sample_valid: false,
      main_surface_sample_valid: false,
      resolution_source: null,
      data_status: "not_found",
      errors: errors.slice(-8)
    };
  }

  async function enrichOne(workerUrl, row, sourceState) {
    const rowTour = utils.tour(row);
    const playerSchedule = rowTour
      ? sourceState.schedules[rowTour] || []
      : [...(sourceState.schedules.ATP || []), ...(sourceState.schedules.WTA || [])];

    let surfaceInfo;
    let surfaceSource;
    const sourceFields = {
      "365Scores": {},
      "TennisRatio賽事場地": {}
    };

    if (utils.usesTennisRatioScheduleSurface(row)) {
      surfaceInfo = tennisratio.scheduleSurface(
        row,
        sourceState.schedules[rowTour] || []
      );
      surfaceSource = "TennisRatio賽程";
      sourceFields["TennisRatio賽事場地"] = { ...surfaceInfo };
    } else {
      surfaceInfo = await scores365.resolveSurface(
        workerUrl,
        row,
        sourceState.scoreSnapshots
      );
      surfaceSource = "365Scores";
      sourceFields["365Scores"] = { ...surfaceInfo };
    }

    const surface = String(surfaceInfo?.surface || "");
    const surfaceKey = new Set(["hard", "clay", "grass"])
      .has(surface.toLocaleLowerCase("en-US"))
      ? surface.toLocaleLowerCase("en-US")
      : null;

    const names = [String(row?.["主場"] || ""), String(row?.["客場"] || "")];
    const playerResults = await Promise.allSettled([
      tennisratio.resolvePlayer({
        workerUrl,
        name: names[0],
        surface: surfaceKey,
        tour: rowTour,
        schedules: playerSchedule
      }),
      tennisratio.resolvePlayer({
        workerUrl,
        name: names[1],
        surface: surfaceKey,
        tour: rowTour,
        schedules: playerSchedule
      })
    ]);

    const homePlayer = playerResults[0].status === "fulfilled"
      ? playerResults[0].value
      : emptyPlayer(names[0], surfaceKey, [playerResults[0].reason?.message || String(playerResults[0].reason)]);
    const awayPlayer = playerResults[1].status === "fulfilled"
      ? playerResults[1].value
      : emptyPlayer(names[1], surfaceKey, [playerResults[1].reason?.message || String(playerResults[1].reason)]);

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
        away_player_found: Boolean(awayPlayer.found)
      }
    };
  }

  function summarize(matches) {
    const summary = {
      input_matches: matches.length,
      surface_resolved: 0,
      both_players_found: 0,
      one_or_more_players_missing: 0,
      complete_players: 0,
      partial_players: 0,
      not_found_players: 0
    };
    for (const item of matches) {
      if (item?.source_status?.surface_resolved) summary.surface_resolved += 1;
      if (
        item?.source_status?.home_player_found &&
        item?.source_status?.away_player_found
      ) summary.both_players_found += 1;
      else summary.one_or_more_players_missing += 1;

      for (const player of [
        item?.TennisRatio?.主場球員,
        item?.TennisRatio?.客場球員
      ]) {
        if (player?.data_status === "complete") summary.complete_players += 1;
        else if (player?.data_status === "partial") summary.partial_players += 1;
        else summary.not_found_players += 1;
      }
    }
    return summary;
  }

  async function buildSourceBundle(todayPayload, options = {}) {
    const workerUrl = String(options.workerUrl || "").trim();
    if (!workerUrl) throw new Error("WORKER_URL 尚未設定。");
    const rows = Array.isArray(todayPayload?.matches)
      ? todayPayload.matches.filter(item => item && typeof item === "object")
      : [];
    const callback = options.progress;

    progress(callback, `Phase 3｜開始載入 ${rows.length} 場的365Scores與TennisRatio資料……`, {
      stage: "source_start",
      total: rows.length
    });
    const sourceState = await loadSurfaceSources(workerUrl, rows, callback);

    let completed = 0;
    const matches = await mapWithConcurrency(
      rows,
      options.concurrency || 2,
      async row => {
        const result = await enrichOne(workerUrl, row, sourceState);
        completed += 1;
        progress(
          callback,
          `Phase 3｜資料 ${completed}/${rows.length}：${result.主場} vs ${result.客場}`,
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
      version: "3.0",
      generated_at_taiwan: utils.isoTaipeiNow(),
      source: {
        Pinnacle: "today_matches.json 的比賽、選手與賠率",
        "365比分網": "ATP／WTA主巡迴場地（由 Cloudflare Worker 代理）",
        TennisRatio賽程: "ATP Challenger／WTA 125場地與球員識別",
        TennisRatio球員: "正式姓名、Profile、排名、All Levels與Main Tour同場地數據"
      },
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
    enrichOne,
    summarize,
    buildSourceBundle
  };
});
