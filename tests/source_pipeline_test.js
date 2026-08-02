"use strict";

const assert = require("assert");
const pipeline = require("../source-pipeline.js");

const summary = pipeline.summarize([
  {
    source_status: {
      surface_resolved: true,
      home_player_found: true,
      away_player_found: true
    },
    TennisRatio: {
      主場球員: { data_status: "complete" },
      客場球員: { data_status: "partial" }
    }
  },
  {
    source_status: {
      surface_resolved: false,
      home_player_found: true,
      away_player_found: false
    },
    TennisRatio: {
      主場球員: { data_status: "partial" },
      客場球員: { data_status: "not_found" }
    }
  }
]);
assert.deepStrictEqual(summary, {
  input_matches: 2,
  surface_resolved: 1,
  both_players_found: 1,
  one_or_more_players_missing: 1,
  complete_players: 1,
  partial_players: 2,
  not_found_players: 1
});

(async () => {
  const values = await pipeline.mapWithConcurrency([1, 2, 3], 2, async value => value * 2);
  assert.deepStrictEqual(values, [2, 4, 6]);
  console.log("PASS source-pipeline schema helpers");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
