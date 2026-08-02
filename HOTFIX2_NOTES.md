# Phase 5 Hotfix 2

## app.js 必填

```js
const ARCADIA_API_KEY = "...";
const WORKER_UPLOAD_TOKEN = "...";
const GEMINI_API_KEY = "...";
```

## 修正

- Gemini Key 可直接填在 app.js。
- app.js Key 優先於 localStorage。
- Pinnacle JSON 改成 Blob 下載。
- Ratio JSON 改成 Blob 下載。
- 不再開啟 Worker JSON 新分頁。
- Cache bust 更新為 `phase5-gemini2-key-download`。
