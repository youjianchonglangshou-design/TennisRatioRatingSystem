const fs = require("fs");
const vm = require("vm");
const path = require("path");

const root = path.resolve(__dirname, "..");
const code = fs.readFileSync(path.join(root, "gemini-client.js"), "utf8");
vm.runInThisContext(code, { filename: "gemini-client.js" });
const client = globalThis.TennisRatioGemini;
if (!client) throw new Error("Gemini client not exported");

const analysis = JSON.parse(fs.readFileSync(path.join(root, "ratio_analysis.json"), "utf8"));
const today = JSON.parse(fs.readFileSync(path.join(root, "today_matches.json"), "utf8"));
const rows = analysis.matches;

const selected = client.buildContext("項次3有沒有傷病？", {
  payload: today,
  analysis,
  rows,
  revision: 12,
  history: []
});
if (selected.context_mode !== "selected_matches") throw new Error("selected mode failed");
if (selected.selected_items[0] !== 3) throw new Error("item selection failed");
if (selected.sent_match_count !== 1) throw new Error("selected count failed");

const name = rows[4].主場;
const selectedByName = client.buildContext(`${name}這場如何？`, {
  payload: today,
  analysis,
  rows,
  history: []
});
if (selectedByName.context_mode !== "selected_matches") throw new Error("name selection failed");

const overview = client.buildContext("整理全部比賽前三名", {
  payload: today,
  analysis,
  rows,
  history: []
});
if (overview.context_mode !== "compact_overview") throw new Error("overview mode failed");
if (overview.table_rows_compact.length !== rows.length) throw new Error("overview count failed");
if (JSON.stringify(overview).length >= JSON.stringify(analysis).length) throw new Error("overview was not compact");

let attempts = 0;
async function mockFetch(url, options) {
  attempts += 1;
  if (attempts === 1) {
    return {
      ok: false,
      status: 429,
      headers: { get: () => "0" },
      text: async () => JSON.stringify({ error: { message: "retry in 0 s" } })
    };
  }
  const body = JSON.parse(options.body);
  if (!body.systemInstruction?.parts?.[0]?.text) throw new Error("system instruction missing");
  if (!Array.isArray(body.tools) || !body.tools[0]?.google_search) throw new Error("google search missing");
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: "測試回答" }] },
        groundingMetadata: {
          webSearchQueries: ["測試搜尋"],
          groundingChunks: [{ web: { title: "官方來源", uri: "https://example.com" } }]
        }
      }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 }
    })
  };
}

(async () => {
  const result = await client.ask("項次3如何？", {
    payload: today,
    analysis,
    rows,
    revision: 99,
    history: [],
    apiKey: "test-key",
    model: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    fetchImpl: mockFetch
  });
  if (result.answer !== "測試回答") throw new Error("answer failed");
  if (result.retry_count !== 1) throw new Error("retry failed");
  if (result.context_mode !== "selected_matches") throw new Error("ask context failed");
  if (result.grounding_sources.length !== 1) throw new Error("sources failed");
  console.log(`PASS Gemini client: ${rows.length} rows / selected + overview + retry + grounding`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
