const fs = require("fs");
const app = fs.readFileSync("../app.js", "utf8");
const html = fs.readFileSync("../index.html", "utf8");
function ok(cond, msg) { if (!cond) throw new Error(msg); }
ok(app.includes("正在檢查 ARCADIA_API_KEY 與 WORKER_UPLOAD_TOKEN"), "missing full config status");
ok(app.includes("正在檢查 WORKER_UPLOAD_TOKEN"), "missing rerun config status");
ok(app.includes("await runFullPipelinePhase4()"), "button does not await full pipeline");
ok(app.includes("await rerunCurrentListPhase4()"), "button does not await rerun pipeline");
ok(app.includes("unhandledrejection"), "missing unhandled rejection diagnostic");
ok(html.includes("app.js?v=phase5-gemini1"), "missing cache bust");
console.log("PASS button hotfix");
