# MIGRATION STATUS

## Phase 1A — 完成

Python 本機版 UI → GitHub Pages 1:1 靜態視覺快照。

## Phase 1B（第二階段）— 完成

`ratio_analysis.json → renderer.js → 完整 DOM`。

- 主表格不再寫死。
- Hover 比賽資訊與完整評級卡不再寫死。
- 任意相同 schema 的新版 `ratio_analysis.json` 可重建畫面。
- 與 Phase 1A 的 20 列、40 個 templates 已做完全一致驗證。

## 下一階段

`matchups.json + markets.json → today_matches.json` 全 JS 移植與 Python 輸出對照。

之後再進入：

- 外部 365Scores／TennisRatio 資料來源
- Formula B／15項／5項／D值／EV／評級／BO3 計算引擎
- 兩顆執行按鈕
- R2 保存 `today_matches.json` 與 `ratio_analysis.json`
- Gemini 瀏覽器端 API
