# TennisRatioRatingSystem — Phase 5 Gemini 全 JavaScript

## 完成內容

- 保留原本左側 Gemini 抽屜與模型設定視窗。
- Gemini API 改由瀏覽器 JavaScript 直接呼叫。
- API Key、Base URL、模型名稱與自訂系統提示儲存在目前瀏覽器 localStorage。
- 使用 `generateContent` REST API。
- 預設模型：`gemini-2.5-flash`。
- Temperature：2.5 模型固定為 0；Gemini 3.x 自動移除舊式 sampling 參數。
- 啟用 Google Search grounding，回答下方顯示搜尋詞與來源連結。
- HTTP 429／5xx／網路中斷自動重試，最多 3 次。
- 問題上下文採機械選擇：
  - 問到項次、場次、編號、完整球員姓名：最多傳 4 場完整資料。
  - 問整體、排行、哪些場：傳全部場次精簡表。
  - 追問未重複提及球員時：沿用最近 6 則對話中的指定場次。
- 每次回答顯示：上下文模式、傳送場次數、請求大小與重試次數。

## 使用方式

1. 覆蓋 GitHub Pages 儲存庫檔案。
2. 按 `Ctrl + F5`。
3. 點左上方 `✦ Gemini`。
4. 第一次會自動開啟模型設定。
5. 貼上 Google AI Studio Gemini API Key，儲存。
6. 輸入問題並送出。

## Worker

Phase 5 不需要修改 Cloudflare Worker。
Gemini 是瀏覽器直接連線 Google API；R2 仍負責 TennisRatio JSON。

## 憑證提醒

Gemini API Key 儲存在 localStorage，不會 commit 到 GitHub 或寫入 R2；但任何前端 API Key 都可能被目前瀏覽器使用者查看。建議在 Google Cloud／AI Studio 設定網站來源限制與額度限制。

---

## Phase 5 Hotfix 2

### app.js 可直接填 Gemini API Key

```js
const GEMINI_API_KEY =
  "你的 Google AI Studio API Key";
```

app.js 設定優先於模型設定視窗與 localStorage。

### JSON 下載已修正

兩個按鈕現在使用 Blob 真正下載到電腦：

```text
下載Pinnacle JSON → today_matches.json
下載Ratio JSON → ratio_analysis.json
```

不再另開 Cloudflare Worker JSON 頁面。

### 安全提醒

公開 GitHub 中的 `ARCADIA_API_KEY`、`WORKER_UPLOAD_TOKEN`
與 `GEMINI_API_KEY` 都能被查看。此方式只適合快速測試。
