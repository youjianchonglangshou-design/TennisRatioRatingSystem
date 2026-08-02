# MIGRATION STATUS

## Phase 1A — 完成

Python 本機版 UI → GitHub Pages 1:1 靜態視覺快照。

## Phase 1B — 完成

`ratio_analysis.json → renderer.js → 完整 DOM`。

## Phase 2 — 完成

`Arcadia matchups + markets → pinnacle.js → today_matches.json → Cloudflare R2`。

## Phase 3 — 完成

`today_matches.json → 365Scores／TennisRatio → source_bundle.json → Cloudflare R2`。

已完成：

- 365Scores ATP／WTA 主巡迴場地。
- TennisRatio ATP／WTA 賽程解析。
- ATP Challenger／WTA 125 場地。
- 球員正式姓名、ID、Profile 與排名。
- 同場地 All Levels 與 Main Tour 數據。
- 資料錯誤與完整度摘要。
- 「重新抓取＋完整分析」執行 Phase 2＋Phase 3。
- 「只重跑目前清單」直接重跑 Phase 3。
- Worker source proxy 與 R2 `source_bundle.json`。

## 下一階段

- 移植 `analysis_engine.py`。
- Formula B。
- 原始 15 項。
- 評級 5 項。
- D 值、EV、A／B／C／淘汰。
- BO3 機械預測。
- 建立並上傳新的 `ratio_analysis.json`。

## 後續

- Gemini 瀏覽器端 API。
- 正式憑證管理。
