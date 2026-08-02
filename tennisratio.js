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
    if (requestCache.has(url)) return requestCache.get(url);
    const promise = fetch(url, { cache: "no-store" }).then(async response => {
      if (!response.ok) {
        const detail = await responseDetail(response, "TennisRatio讀取失敗");
        throw new Error(`TennisRatio HTTP ${response.status}：${detail}`);
      }
      return response.text();
    });
    requestCache.set(url, promise);
    try {
      return await promise;
    } catch (error) {
      requestCache.delete(url);
      throw error;
    }
  }

  async function fetchJson(url) {
    if (requestCache.has(url)) return requestCache.get(url);
    const promise = fetch(url, { cache: "no-store" }).then(async response => {
      if (!response.ok) {
        const detail = await responseDetail(response, "TennisRatio讀取失敗");
        throw new Error(`TennisRatio HTTP ${response.status}：${detail}`);
      }
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("TennisRatio球員統計不是有效JSON。");
      }
    });
    requestCache.set(url, promise);
    try {
      return await promise;
    } catch (error) {
      requestCache.delete(url);
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

  function scheduleIdentity(playerName, schedules) {
    const matches = [];
    for (const item of Array.isArray(schedules) ? schedules : []) {
      for (const side of ["a", "b"]) {
        const officialName = String(item?.[`player_${side}`] || "");
        const playerId = String(item?.[`player_${side}_id`] || "");
        const score = utils.similarity(playerName, officialName);
        if (utils.compatibleName(playerName, officialName) || score >= 0.88) {
          matches.push([
            score,
            officialName,
            playerId,
            item.h2h_url || null,
            item.surface || null
          ]);
        }
      }
    }
    if (!matches.length) return [null, null, null, null];
    matches.sort((left, right) => right[0] - left[0]);
    const best = matches[0];
    if (
      matches.length > 1 &&
      best[0] - matches[1][0] < 0.04 &&
      best[1] !== matches[1][1]
    ) return [null, null, null, null];
    return [best[1], best[2], best[3], best[4]];
  }

  function validStats(data) {
    return Number(data?.stats?.matches_played || 0) > 0;
  }

  async function resolvePlayer({ workerUrl, name, surface, tour, schedules }) {
    const [officialName, scheduleId, h2hUrl, scheduleSurface] =
      scheduleIdentity(name, schedules);
    const effectiveSurface = String(surface || scheduleSurface || "").toLocaleLowerCase("en-US") || null;
    const expectedNames = [officialName, name]
      .map(value => String(value || "").trim())
      .filter(Boolean);
    const candidateIds = [];

    function addCandidate(value, source) {
      const candidate = String(value || "").replace(/[^A-Za-z0-9]/g, "");
      if (candidate && !candidateIds.some(item => item[0] === candidate)) {
        candidateIds.push([candidate, source]);
      }
    }

    addCandidate(scheduleId, "schedule_player_id");
    for (const candidateName of expectedNames) {
      addCandidate(playerIdFromName(candidateName), "name_generated_id");
    }
    for (const playerId of await directoryPlayerIds(workerUrl, name, tour)) {
      addCandidate(playerId, "player_directory");
    }

    const errors = [];
    for (const [playerId, resolutionSource] of candidateIds) {
      let allData = null;
      let mainData = null;
      let profile = null;
      let actualName = officialName || name;

      if (SURFACES.has(effectiveSurface)) {
        const statsResults = await Promise.allSettled([
          fetchPlayerStats(workerUrl, playerId, effectiveSurface, "all"),
          fetchPlayerStats(workerUrl, playerId, effectiveSurface, "main")
        ]);
        for (const [index, result] of statsResults.entries()) {
          const level = index === 0 ? "all" : "main";
          if (result.status === "rejected") {
            errors.push(result.reason?.message || String(result.reason));
            continue;
          }
          const data = result.value;
          const returnedName = String(data.player_name || data.name || "").trim();
          if (
            returnedName &&
            !expectedNames.some(expected => utils.compatibleName(expected, returnedName))
          ) {
            errors.push(`${playerId}/${level}回傳${returnedName}，與${name}不相容`);
            continue;
          }
          actualName = returnedName || actualName;
          if (level === "all") allData = data;
          else mainData = data;
        }
      }

      try {
        profile = await fetchPlayerProfileRank(workerUrl, playerId, actualName);
        actualName = profile.name || actualName;
      } catch (error) {
        errors.push(error?.message || String(error));
      }

      if (!allData && !mainData && !profile) continue;
      const allValid = validStats(allData || {});
      const mainValid = validStats(mainData || {});
      return {
        found: true,
        Pinnacle姓名: name,
        正式姓名: actualName,
        player_id: playerId,
        rank: profile?.rank ?? null,
        rank_source: profile?.rank_source ?? null,
        profile_url: profile?.profile_url || `${BASE_URL}/players/${encodeURIComponent(playerId)}.html`,
        h2h_url: h2hUrl,
        surface: effectiveSurface,
        all_surface: allValid ? allData : {},
        main_surface: mainValid ? mainData : {},
        all_surface_sample_valid: allValid,
        main_surface_sample_valid: mainValid,
        resolution_source: resolutionSource,
        data_status: allData && mainData && profile ? "complete" : "partial",
        errors: errors.slice(-6)
      };
    }

    return {
      found: false,
      Pinnacle姓名: name,
      正式姓名: officialName || name,
      player_id: null,
      rank: null,
      rank_source: null,
      profile_url: null,
      h2h_url: h2hUrl,
      surface: effectiveSurface,
      all_surface: {},
      main_surface: {},
      all_surface_sample_valid: false,
      main_surface_sample_valid: false,
      resolution_source: null,
      data_status: "not_found",
      errors: errors.slice(-8)
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
    validStats,
    clearMemoryCache: () => requestCache.clear()
  };
});
