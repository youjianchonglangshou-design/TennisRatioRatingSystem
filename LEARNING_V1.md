# TennisRatio Learning 賽後學習資料層 v1

## 已完成

1. Pinnacle `matchup.id` 會保留成 `match_id` 與 `Pinnacle賽事ID`，一路進入 `ratio_analysis.json`。
2. 每次 `upload-analysis` 仍更新 `ratio_analysis.json`，同時另存不可覆蓋的時間戳快照：
   - `analysis/YYYY/MM/DD/ratio_analysis_YYYYMMDD_HHMMSS_mmm_xxxxxx.json`
3. 每個未結算 `match_id` 登記到：
   - `learning/pending.json`
4. 完賽後建立：
   - `settlement/results/YYYY-MM-DD.json`
   - `learning/experience/YYYY-MM-DD.json`
5. 同場多個賽前 Snapshot 全部保留，但每筆 `sample_weight = 1 / 該場有效賽前Snapshot數`。
6. 開賽後產生的快照、`已過期=true` 快照不進 Training Dataset，避免 Look-ahead Leakage。
7. `external_risk.json` 也會另存時間戳快照：
   - `risk/YYYY/MM/DD/external_risk_*.json`
8. 主表格新增 `AI自己的想法`。尚無正式模型時顯示「學習中」。
9. `modules/learning.js` 永遠只讀：
   - `GET /learning/current-model`
10. Worker 提供：
    - `GET /learning/status`
    - `POST /learning/settle`（Bearer `UPLOAD_TOKEN`，可手動測試覆盤）
    - `scheduled()`（設定 Cloudflare Cron Trigger 後可自動覆盤）

## R2 結構

```text
ratio_analysis.json                    # 最新分析，供目前網頁讀取
external_risk.json                     # 最新風險資料

analysis/
  2026/08/10/
    ratio_analysis_20260810_....json   # 永久賽前快照

risk/
  2026/08/10/
    external_risk_20260810_....json    # 永久風險快照

learning/
  pending.json
  current_model.json
  models/
    model_v001.json                    # 第二階段才會開始產生
  experience/
    2026-08-10.json

settlement/
  results/
    2026-08-10.json
```

## 第一次部署後

- GitHub Pages：覆蓋本 ZIP 的檔案。
- Cloudflare Worker：用另外提供的新版 `work.js` 覆蓋現有 Worker。
- 先不用建立模型；下一次完整分析後 `AI自己的想法` 會顯示「學習中」。
- 若要測試賽果結算，可對 Worker `POST /learning/settle`，Authorization 使用現有 `UPLOAD_TOKEN`。
- 全自動覆盤排程已決定為台灣時間 15:00、03:00（每 12 小時一次）。Cloudflare Cron 使用 UTC，請設定 `0 7,19 * * *`。詳細步驟見 `Cloudflare/CRON_TRIGGER.md`。

## 本版已內附 Cloudflare Worker

不需要另外下載 `work.js`。壓縮包內同時提供：

- `Cloudflare/work.js`：建議拿這支覆蓋 Cloudflare Worker。
- `work.js`：同內容的根目錄備份。
- `Cloudflare/CRON_TRIGGER.md`：台灣時間自動覆盤排程說明。
- `Cloudflare/wrangler.cron.example.toml`：若使用 Wrangler，可把 triggers 片段併入既有設定。
