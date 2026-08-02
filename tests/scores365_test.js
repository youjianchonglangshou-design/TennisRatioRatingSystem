"use strict";

const assert = require("assert");
const scores365 = require("../scores365.js");

const row = {
  日期時間: "2026-08-02 21:00",
  聯賽: "ATP 1000 Montreal - R1",
  主場: "Matteo Berrettini",
  客場: "Mariano Navone"
};
const snapshot = {
  competitions: [{ id: 33, name: "ATP Montreal Hard" }],
  games: [{
    id: 123,
    competitionId: 33,
    competitionDisplayName: "ATP Montreal Hard",
    startTime: "2026-08-02T13:00:00Z",
    homeCompetitor: { id: 1, name: "Matteo Berrettini" },
    awayCompetitor: { id: 2, name: "Mariano Navone" }
  }]
};
const matched = scores365.match(row, [snapshot]);
assert(matched);
assert.strictEqual(matched.game.id, 123);
assert.strictEqual(matched.主場365姓名, "Matteo Berrettini");
assert.strictEqual(scores365.surfaceText("ATP Montreal Hard"), "Hard");
assert.strictEqual(scores365.surfaceText("WTA Rome Clay"), "Clay");
console.log("PASS scores365 synthetic matching");
