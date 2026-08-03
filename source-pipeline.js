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
