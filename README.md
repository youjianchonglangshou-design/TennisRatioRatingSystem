# TennisRatioRatingSystem｜結構整合版 v1

## 正式執行檔

```text
index.html
styles.css
app.js
renderer.js
pinnacle.js
data-services.js
analysis-engine.js
gemini-client.js
ratio_config.json
today_matches.json
ratio_analysis.json
.nojekyll
LICENSE
README.md
```

## JavaScript 結構

```text
app.js
├─ 頁面啟動
├─ 按鈕與篩選
├─ 完整分析流程編排
├─ JSON 下載
└─ Gemini 對話介面控制

pinnacle.js
└─ Arcadia matchups／markets → today_matches.json

data-services.js
├─ 共用工具
├─ 365Scores 場地與排名
├─ TennisRatio 統計、限流與排名補位
├─ source_bundle.json 建立流程
└─ Cloudflare R2 Client

analysis-engine.js
└─ Formula B、15項、5項、D值、EV、評級與 BO3

renderer.js
└─ 主表格、膠囊、Hover 完整評級卡

gemini-client.js
└─ 精簡上下文與 Cloudflare Gemini Proxy
```

原本 GitHub Pages 載入 10 支 JavaScript；整合後載入 6 支。

## 保留三個 JSON 的原因

```text
ratio_config.json
→ 分析公式與門檻設定，app.js 會讀取。

today_matches.json
→ R2 暫時不可用時的比賽清單 fallback。

ratio_analysis.json
→ R2 暫時不可用時的分析畫面 fallback。
```

## 部署步驟

1. 上傳／覆蓋 `data-services.js`、`index.html`、`README.md`。
2. 依 `DELETE_FROM_GITHUB.txt` 刪除舊模組與開發檔。
3. 等 GitHub Pages 部署。
4. 按 `Ctrl + F5`。
5. 先確認首頁載入，再按「只重跑目前清單」。

此版本不覆蓋 `app.js`，因此你已填好的 Arcadia Key 與
Worker Upload Token 不會消失。
