"use strict";

const assert = require("assert");
const utils = require("../source-utils.js");

assert.strictEqual(utils.normalize("Gaël Monfils"), "gaelmonfils");
assert(utils.similarity("Matteo Berrettini", "Matteo Berrettini") === 1);
assert(utils.similarity("Christopher O'Connell", "Christopher Oconnell") > 0.92);
assert(utils.compatibleName("J. L. Struff", "Jan Lennard Struff") === false);
assert(utils.compatibleName("Alex de Minaur", "Alex De Minaur") === true);
assert.strictEqual(utils.tournamentLevel("ATP Challenger Hagen - R32"), "ATP Challenger");
assert.strictEqual(utils.tournamentLevel("WTA 125K Vancouver - QF"), "WTA 125");
assert.strictEqual(utils.roundName("ATP Washington - SF"), "Semifinal");
assert.strictEqual(utils.tournamentName("ATP 1000 Montreal - R1"), "Montreal");
assert.strictEqual(utils.tour({ 聯賽: "WTA 1000 Toronto - R1" }), "WTA");
assert.strictEqual(
  utils.usesTennisRatioScheduleSurface({ 聯賽: "ATP Challenger Hagen - R32" }),
  true
);

console.log("PASS source-utils");
