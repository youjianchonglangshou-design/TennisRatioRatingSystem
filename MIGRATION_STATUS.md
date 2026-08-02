# MIGRATION STATUS

## Phase 1A — 完成

Python 本機版 UI → GitHub Pages 靜態視覺基線。

## Phase 1B — 下一步

把 `_table_document()` 與其所有 Python HTML helper 逐一轉成 JavaScript renderer，讓 R2 的任意新版
`ratio_analysis.json` 都能在瀏覽器端重建完全相同畫面。

## Phase 2

`matchups.json + markets.json → today_matches.json` 全 JS 對照測試。

## Phase 3

Formula B、15項、5項、D值、EV、評級、BO3 分析引擎轉 JS。
