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
    const text = String(league || "").toLocaleLowerCase("en-US");
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
    if (/\bwta\b|\bwomen\b/.test(text)) return "WTA";
    if (/\batp\b|\bmen\b/.test(text)) return "ATP";
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
