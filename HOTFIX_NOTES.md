# Phase 4 Hotfix 1｜按鈕無反應修復

## 問題原因

覆蓋 Phase 4 壓縮包後，`app.js` 內的兩組設定會恢復成提示文字：

```js
const ARCADIA_API_KEY =
  "請把你的 Arcadia API Key 貼在這裡";

const WORKER_UPLOAD_TOKEN =
  "請把你的 UPLOAD_TOKEN 貼在這裡";
```

原版按鈕在 `try...catch` 外檢查這些設定。設定缺失時 Promise 直接拒絕，
畫面狀態列沒有更新，因此視覺上像完全沒有反應。

## 本次修正

- 設定檢查移入 `try...catch`。
- 按下按鈕後先顯示「正在檢查設定」。
- 缺 Key 時狀態列直接顯示缺少哪一項。
- 按鈕事件增加最外層錯誤保險。
- 增加 `error` 與 `unhandledrejection` 畫面診斷。
- 所有 JavaScript URL 加入 `?v=phase4-hotfix1`，避免 GitHub Pages 使用舊快取。

## 上傳前必填

打開 `app.js`：

```js
const ARCADIA_API_KEY =
  "你的 Arcadia API Key";

const WORKER_UPLOAD_TOKEN =
  "你的 Cloudflare UPLOAD_TOKEN";
```

Worker 根網址顯示 `Not found` 是正常的。可用路由包含：

```text
/health
/today_matches.json
/source_bundle.json
/ratio_analysis.json
```
