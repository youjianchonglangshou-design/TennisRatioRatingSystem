# TennisRatioRatingSystem — Phase 1B 全 JS 動態渲染

這一版完成了第二個轉換節點：不再依賴 Python 預先把每場比賽寫死在 HTML。

## 已完成

- `app.js` 在 GitHub Pages 載入：
  - `ratio_analysis.json`
  - `today_matches.json`
- `renderer.js` 根據 JSON 動態建立：
  - 主表格全部比賽列
  - 日期、比賽資訊、主客場、賠率、勝率、EV、評級與 D 值
  - 排名 SSR／SR／R／N／C 膠囊
  - 比賽資訊 Hover 卡
  - TennisRatio 雙方數據＋評級整合 Hover 卡
  - All Levels／Main Tour 分頁
  - 原始 15 項統計、評級 5 項、D 值、EV、最終評級
  - BO3 機械預測
  - H2H 網址與複製按鈕
- A／B／C／淘汰／冷門方／資料不足等數量由 JSON 即時計算。
- 搜尋、篩選、排序、複製與 Hover 定位在動態渲染後仍可使用。
- 更新時間與 Pinnacle 抓取時間改由兩份 JSON 動態顯示。
- Gemini 側邊欄與設定介面保留原視覺；API 呼叫仍留到後續階段。
- 兩個分析按鈕保留原位置與讀取狀態，但尚未接入分析管線。

## 1:1 驗證

本次使用 Phase 1A 的同一份 `ratio_analysis.json` 驗證：

- 20 個主表格 `<tr>`：動態 JS 輸出與 Python 快照完全一致。
- 20 個比賽資訊 template＋20 個整合評級 template：完全一致。

驗證摘要見 `renderer_parity_report.json`。

## 現在可以做什麼

直接替換 `ratio_analysis.json` 後重新整理頁面，JS 會依新 JSON 重建場次、篩選數量與 Hover 卡片，不再受舊快照場數限制。

## 尚未完成

- `重新抓取＋完整分析` 尚未接 Arcadia／R2／JS 分析引擎。
- `只重跑目前清單` 尚未接 `today_matches.json` 分析流程。
- `matchups.json + markets.json → today_matches.json` 尚未搬入本專案。
- Formula B、15項、5項、評級與 BO3 的「計算」仍使用現有 JSON 結果；本階段只負責完整 UI renderer。
- Gemini 尚未改成瀏覽器端 API。

## GitHub Pages

將壓縮包內全部檔案放到 `TennisRatioRatingSystem` 根目錄，Pages 使用 `main / (root)`。
