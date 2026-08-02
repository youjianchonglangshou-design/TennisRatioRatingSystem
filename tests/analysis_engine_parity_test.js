const assert = require("assert");
const fs = require("fs");
const path = require("path");
const engine = require("../analysis-engine.js");

const root = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "ratio_config.json"), "utf8"));
const expected = JSON.parse(fs.readFileSync(path.join(root, "ratio_analysis.json"), "utf8"));

const sourceBundle = {
  source_errors: {
    "365Scores": expected["365Scores_errors"] || {},
    TennisRatio_schedule: expected.TennisRatio_schedule_errors || {}
  },
  matches: expected.matches.map(match => ({
    項次: match.項次,
    日期時間: match.日期時間,
    聯賽: match.聯賽,
    主場: match.主場,
    客場: match.客場,
    主場名次: match.主場名次,
    客場名次: match.客場名次,
    主場賠率: match.主場賠率,
    客場賠率: match.客場賠率,
    比賽資訊: match.比賽資訊,
    Pinnacle比賽資訊: match.Pinnacle比賽資訊,
    "365Scores": match["365Scores"],
    TennisRatio賽事場地: match.TennisRatio賽事場地,
    TennisRatio: match.TennisRatio
  }))
};

function compare(expectedValue, actualValue, pointer = "$", tolerance = 1e-12) {
  if (
    typeof expectedValue === "number" &&
    typeof actualValue === "number"
  ) {
    assert.ok(
      Math.abs(expectedValue - actualValue) <= tolerance,
      `${pointer}: ${actualValue} != ${expectedValue}`
    );
    return;
  }

  if (Array.isArray(expectedValue)) {
    assert.ok(Array.isArray(actualValue), `${pointer}: expected array`);
    assert.strictEqual(actualValue.length, expectedValue.length, `${pointer}: array length`);
    expectedValue.forEach((value, index) => {
      compare(value, actualValue[index], `${pointer}[${index}]`, tolerance);
    });
    return;
  }

  if (expectedValue && typeof expectedValue === "object") {
    assert.ok(actualValue && typeof actualValue === "object" && !Array.isArray(actualValue), `${pointer}: expected object`);
    assert.deepStrictEqual(Object.keys(actualValue).sort(), Object.keys(expectedValue).sort(), `${pointer}: object keys`);
    for (const key of Object.keys(expectedValue)) {
      compare(expectedValue[key], actualValue[key], `${pointer}.${key}`, tolerance);
    }
    return;
  }

  assert.strictEqual(actualValue, expectedValue, pointer);
}

(async () => {
  const actual = await engine.buildAnalysis(sourceBundle, config, {
    now: new Date(expected.generated_at_taiwan)
  });
  compare(expected, actual);
  console.log(`PASS analysis-engine: ${actual.matches.length} matches / numeric tolerance 1e-12`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
