# MIGRATION STATUS

## Phase 1A — 完成

Python 本機版 UI → GitHub Pages 1:1 靜態視覺快照。

## Phase 1B — 完成

`ratio_analysis.json → renderer.js → 完整 DOM`。

## Phase 2 — 完成

`Arcadia matchups + markets → pinnacle.js → today_matches.json → Cloudflare R2`。

已接通：

- 「重新抓取＋完整分析」的 Pinnacle 前置階段。
- 「只重跑目前清單」的 R2 `today_matches.json` 載入階段。
- Python `pinnacle.py` 的賠率換算、篩選、聯賽層級、時間與輸出 schema。

## 下一階段

先做外部資料來源能力測試與移植：

- 365Scores 場地／賽程資料。
- TennisRatio 賽程、球員、排名與 All Levels／Main Tour 數據。
- 確認瀏覽器直連或 Worker proxy。

之後再接：

- Formula B／15項／5項／D值／EV／評級／BO3。
- `ratio_analysis.json` 上傳 R2。
- Gemini 瀏覽器端 API。
