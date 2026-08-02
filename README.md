# TennisRatioRatingSystem — Phase 2 Arcadia → today_matches.json

這一版完成第三個轉換節點：將本機版 `modules/pinnacle.py` 的核心資料管線移植成瀏覽器 JavaScript。

## 已完成

- 新增 `pinnacle.js`：
  - 瀏覽器直接抓取 Arcadia `matchups` 與 `markets/straight`。
  - `matchupId` 配對。
  - 美式賠率轉十進位賠率。
  - 過濾 ITF、Doubles。
  - 賠率範圍維持 1.50～1.75。
  - League ID＋League name＋fallback 層級辨識。
  - 台灣時間轉換、排序與項次。
  - 產生和 Python 版相同 schema 的 `today_matches.json`。
- 新增 `r2-client.js`：將 `matchups.json`、`markets.json`、`today_matches.json` 一次送入 Worker。
- `重新抓取＋完整分析` 在本階段已接通 Pinnacle 前置流程：
  - 抓兩個 API。
  - 組裝 `today_matches.json`。
  - 上傳 R2。
  - 從 R2 讀回驗證。
- `只重跑目前清單` 現在會讀取 R2 既有 `today_matches.json`；分析引擎仍留到下一階段。
- 頁面進入時優先讀取 R2 的 `today_matches.json`，尚未建立時才讀儲存庫內 fallback。
- Phase 1B 的 1:1 動態 UI renderer 完整保留。

## 必填設定

打開 `app.js`：

```js
const ARCADIA_API_KEY =
  "你的 Arcadia API Key";

const WORKER_UPLOAD_TOKEN =
  "你的 Cloudflare UPLOAD_TOKEN";
```

## Cloudflare Worker 必須更新

將 `cloudflare-worker.js` 全部貼到 `tennis-json-store` Worker，Deploy。
更新後 Worker 才會保存與提供：

- `matchups.json`
- `markets.json`
- `today_matches.json`
- `ratio_analysis.json`（先保留給後續階段）
- `meta.json`

## 測試

```bash
node tests/pinnacle_parity_test.js
node tests/parity_test.js
```

## 尚未完成

- 365Scores／TennisRatio 外部資料來源。
- Formula B、15項、5項、D值、EV、評級與 BO3 計算。
- 產生新的 `ratio_analysis.json`。
- Gemini 瀏覽器端 API。
