const fs = require("fs");
const assert = require("assert");
const pinnacle = require("./pinnacle.js");

const expected = JSON.parse(fs.readFileSync("../today_matches.json", "utf8"));

function americanFromDecimal(decimal) {
  const value = Number(decimal);
  return value >= 2 ? (value - 1) * 100 : -100 / (value - 1);
}

function leagueId(name, index) {
  if (name.startsWith("ATP Montreal")) return 221306;
  if (name.startsWith("WTA Toronto")) return 206049;
  if (name.startsWith("ATP Washington")) return 4359;
  if (name.startsWith("WTA Washington")) return 5007;
  return 900000 + index;
}

const matchups = expected.matches.map((row, index) => ({
  id: 100000 + index,
  startTime: new Date(`${row["日期時間"].replace(" ", "T")}:00+08:00`).toISOString(),
  league: { id: leagueId(row["聯賽"], index), name: row["聯賽"] },
  participants: [
    { alignment: "home", name: row["主場"] },
    { alignment: "away", name: row["客場"] }
  ]
}));

const markets = expected.matches.map((row, index) => ({
  matchupId: 100000 + index,
  type: "moneyline",
  period: 0,
  prices: [
    { designation: "home", price: americanFromDecimal(row["主場賠率"]) },
    { designation: "away", price: americanFromDecimal(row["客場賠率"]) }
  ]
}));

matchups.push({
  id: 999001,
  startTime: "2026-08-02T12:00:00Z",
  league: { id: 999001, name: "ITF Test - R1" },
  participants: [
    { alignment: "home", name: "Filtered Home" },
    { alignment: "away", name: "Filtered Away" }
  ]
});
markets.push({
  matchupId: 999001,
  type: "moneyline",
  period: 0,
  prices: [
    { designation: "home", price: -150 },
    { designation: "away", price: 130 }
  ]
});

matchups.push({
  id: 999002,
  startTime: "2026-08-02T12:00:00Z",
  league: { id: 999002, name: "ATP Test Doubles - R1" },
  participants: [
    { alignment: "home", name: "A / B" },
    { alignment: "away", name: "C / D" }
  ]
});
markets.push({
  matchupId: 999002,
  type: "moneyline",
  period: 0,
  prices: [
    { designation: "home", price: -150 },
    { designation: "away", price: 130 }
  ]
});

const actual = pinnacle.buildTodayMatches(matchups, markets, {
  minOdds: 1.5,
  maxOdds: 1.75,
  now: new Date("2026-08-02T04:13:23Z")
});

assert.deepStrictEqual(actual, expected);
assert.strictEqual(pinnacle.tournamentLevel({ id: 221306, name: "ATP Montreal - R1" }), "ATP 1000");
assert.strictEqual(pinnacle.tournamentLevel({ id: 206049, name: "WTA Toronto - R1" }), "WTA 1000");
assert.strictEqual(pinnacle.leagueNameForOutput({ id: 221306, name: "ATP Montreal - R1" }), "ATP Montreal - R1");
console.log(`PASS: pinnacle.js produced ${actual.matches.length} canonical today_matches rows`);
