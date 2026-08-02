# TennisRatioRatingSystem — Phase 3

## 這一階段完成的資料管線

```text
R2 today_matches.json
        ↓
365Scores：ATP／WTA 主巡迴場地
TennisRatio：賽程、球員識別、排名、All Levels、Main Tour
        ↓
source_bundle.json
        ↓
Cloudflare Worker
        ↓
Cloudflare R2
```

這一版尚未執行 Formula B、15 項、5 項、D 值、EV、評級與 BO3。
主畫面仍顯示上一份 `ratio_analysis.json`，但外部資料層已改成全 JavaScript。

## 新增的 JavaScript 模組

### `source-utils.js`

移植本機版共用資料邏輯：

- 姓名正規化與相似度。
- 台灣時間解析。
- ATP／WTA、層級、賽事名稱與輪次。
- Challenger／WTA 125 場地來源判斷。
- H2H URL 與比賽資訊結構。

### `scores365.js`

移植 `modules/scores365.py`：

- 依日期取得 365Scores 網球清單。
- 以雙方姓名、時間與聯賽配對比賽。
- 取得比賽明細。
- 解析 `Hard`、`Clay`、`Grass`。
- 配對失敗時保留明確狀態，不猜測場地。

### `tennisratio.js`

移植 `modules/tennisratio.py` 的資料來源部分：

- ATP／WTA 賽程 HTML 解析。
- 正式球員姓名與 player ID。
- 球員 Profile 與目前排名。
- 同場地 All Levels 數據。
- 同場地 Main Tour 數據。
- ATP Challenger／WTA 125 賽事場地。
- H2H URL。
- 多種 player ID fallback 與身分驗證。

### `source-pipeline.js`

依 `today_matches.json` 逐場整合：

- Pinnacle 原始比賽骨架。
- 365Scores 或 TennisRatio 場地。
- 雙方球員資料。
- 資料完整度與錯誤紀錄。

最後產生：

```text
source_bundle.json
```

## 兩顆按鈕目前的行為

### 重新抓取＋完整分析

```text
瀏覽器抓 Arcadia
→ 建立 today_matches.json
→ 寫入 R2
→ 執行 365Scores／TennisRatio 資料階段
→ 建立 source_bundle.json
→ 寫入 R2
```

目前停在外部資料完成，尚未產生新的 `ratio_analysis.json`。

### 只重跑目前清單

```text
讀取 R2 既有 today_matches.json
→ 不重新抓 Arcadia
→ 重跑 365Scores／TennisRatio
→ 覆蓋 R2 source_bundle.json
```

## Cloudflare Worker 必須更新

將壓縮包內的：

```text
cloudflare-worker.js
```

完整貼入 `tennis-json-store` Worker，再按 Deploy。

新增的 Worker 路由：

```text
GET /source/365/day
GET /source/365/game
GET /source/tennisratio/schedule
GET /source/tennisratio/stats
GET /source/tennisratio/profile
GET /source/tennisratio/directory
POST /upload-source
GET /source_bundle.json
```

Worker 仍使用原本設定：

```text
R2 Binding：JSON_BUCKET → tennis-json
Secret：UPLOAD_TOKEN
```

## app.js 必填

```js
const ARCADIA_API_KEY =
  "你的 Arcadia API Key";

const WORKER_UPLOAD_TOKEN =
  "你的 Cloudflare UPLOAD_TOKEN";
```

## 部署後先測試

可打開：

```text
source_probe.html
```

它不會改動 R2，只有檢查：

- Worker health
- 365Scores 指定日期
- TennisRatio ATP 賽程
- TennisRatio WTA 賽程

## R2 新增檔案

```text
source_bundle.json
```

其主要結構：

```json
{
  "version": "3.0",
  "generated_at_taiwan": "...",
  "source_health": {},
  "matches": [
    {
      "項次": 1,
      "比賽資訊": {},
      "365Scores": {},
      "TennisRatio賽事場地": {},
      "TennisRatio": {
        "主場球員": {},
        "客場球員": {}
      }
    }
  ]
}
```

## 測試

在 `tests` 目錄執行：

```bash
node source_utils_test.js
node scores365_test.js
node source_pipeline_test.js
node pinnacle_parity_test.js
node parity_test.js
```

已通過：

- 共用工具邏輯。
- 365Scores 合成配對測試。
- source bundle schema 與摘要。
- 20 場 `today_matches.json` parity。
- 20 列主表格與 40 個 Hover templates parity。

## 下一階段

```text
source_bundle.json
＋
ratio_config.json
        ↓
analysis-engine.js
        ↓
Formula B／15項／5項／D值／EV／評級／BO3
        ↓
ratio_analysis.json
        ↓
Cloudflare R2
```

## 安全提醒

目前為快速轉換測試版。公開 GitHub 儲存庫中的 `app.js` 會公開
`ARCADIA_API_KEY` 與 `WORKER_UPLOAD_TOKEN`。
