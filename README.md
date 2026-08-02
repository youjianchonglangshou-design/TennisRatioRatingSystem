# TennisRatioRatingSystem — Phase 1A 視覺移植基線

此壓縮包可直接上傳到 GitHub 儲存庫根目錄，並用 GitHub Pages 發布。

## 這一版已完成

- 將本機 `tennisratio_web.py` 產生的完整介面拆成純靜態檔案：
  - `index.html`
  - `styles.css`
  - `app.js`
- 移除啟動本機 Python HTTP Server 的必要性。
- 保留目前畫面的原始 DOM、CSS class、尺寸與配色。
- 保留主表格的：
  - 排序
  - 搜尋
  - A／B／C／淘汰等篩選膠囊
  - 主客場排名膠囊
  - 比賽複製按鈕
  - 評級 Hover 詳細卡
  - All Levels／Main Tour 分頁
  - 15 點能量條、5 項、D 值、EV、BO3 卡片
- 保留 Gemini 側邊欄與設定視覺。
- `app.js` 會在頁面載入時，以 JavaScript 讀取並驗證：
  - `ratio_analysis.json`
  - `today_matches.json`
- 目前內附資料：`20` 場。
- 下載 JSON 的網址已改成 GitHub Pages 相對路徑。

## 這一版尚未完成

- 尚未把 Python 的 UI renderer 全部改成「收到任意新版 `ratio_analysis.json` 就即時重建 DOM」。
  - 現階段畫面是以本次 JSON 建立的**精準視覺快照**。
  - JS 會驗證 JSON 場數與快照是否一致。
- 「重新抓取＋完整分析」尚未連接 Arcadia → Worker／R2 → JS 分析引擎。
- 「只重跑目前清單」尚未連接 `today_matches.json` → JS 分析引擎。
- Gemini 後端呼叫尚未改成瀏覽器端 Gemini API。

## 為什麼先做這一小步

這一版先固定 Python 本機版的視覺基線。後續每移植一個 JS renderer，都能拿同一份
`ratio_analysis.json` 對照，避免全 JS 改寫時悄悄改動你原本的排版、膠囊、Hover 卡片與顏色。

## GitHub Pages

1. 將壓縮包內所有檔案上傳到 `TennisRatioRatingSystem` 根目錄。
2. 到 `Settings → Pages`。
3. Source 選 `Deploy from a branch`。
4. Branch 選 `main`，資料夾選 `/ (root)`。
