# TennisRatioRatingSystem — Phase 4

## 已完成全 JavaScript 分析閉環

```text
Arcadia matchups + markets
→ pinnacle.js
→ today_matches.json
→ 365Scores / TennisRatio
→ source_bundle.json
→ analysis-engine.js
→ Formula B / 15項 / 5項 / D值 / EV / 評級 / BO3
→ ratio_analysis.json
→ Cloudflare R2
→ renderer.js 重畫原本介面
```

## 兩顆按鈕

### 重新抓取＋完整分析

1. 瀏覽器抓 Arcadia。
2. 建立並上傳 `today_matches.json`。
3. 重抓 365Scores／TennisRatio。
4. 建立並上傳 `source_bundle.json`。
5. 全 JS 執行分析引擎。
6. 建立並上傳 `ratio_analysis.json`。
7. 從 R2 讀回並立即重畫主畫面。

### 只重跑目前清單

1. 直接讀取 R2 既有 `today_matches.json`。
2. 不抓 Arcadia。
3. 重跑外部資料與完整分析。
4. 覆蓋 `source_bundle.json` 與 `ratio_analysis.json`。

## 新增

- `analysis-engine.js`
- Worker `POST /upload-analysis`
- R2 `ratio_analysis.json` 動態讀寫

## 分析引擎已移植

- Formula B v1.3
- Main Tour／All Levels 機械權重
- 四種排名情境
- 原始 15 項比較
- 評級 5 項比較
- D 值與情境化排名修正
- 評級 EV
- A／B／C／淘汰
- BO3 機械預測
- 過期與資料不足狀態
- `run_health` 統計

## Cloudflare Worker 必須更新

把本壓縮包的 `cloudflare-worker.js` 完整覆蓋 Worker 並 Deploy。
新增路由：

```text
POST /upload-analysis
GET /ratio_analysis.json
```

原本的 R2 Binding 與 `UPLOAD_TOKEN` 不變。

## app.js 必填

```js
const ARCADIA_API_KEY = "你的 Arcadia API Key";
const WORKER_UPLOAD_TOKEN = "你的 Cloudflare UPLOAD_TOKEN";
```

## 測試

```bash
node tests/analysis_engine_parity_test.js
node tests/source_utils_test.js
node tests/scores365_test.js
node tests/source_pipeline_test.js
node tests/pinnacle_parity_test.js
node tests/parity_test.js
```

`analysis_engine_parity_test.js` 使用原 Python 版產生的 20 場 `ratio_analysis.json` 作為基準，完整物件精確一致。

## 尚未完成

- Gemini 瀏覽器端 API。
- 公開儲存庫憑證安全化。
