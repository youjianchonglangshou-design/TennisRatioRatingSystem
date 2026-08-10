# TennisRatio Learning AI v2｜自動訓練與模型迭代

## 本版新增

第一階段的 Snapshot / Pending / 365Scores Settlement / Experience Dataset 全部保留，並新增真正的 Training Engine。

### 自動訓練節奏

- 0～99 場有效獨立覆盤：AI 欄位顯示「學習中」。
- 達 100 場：Worker 自動建立第一個 `learning/models/model_v001.json`，並進入低樣本 Shadow 試判。
- 第一個模型之後，每新增 50 場有效獨立比賽，再訓練一個 Candidate。
- Candidate 會用未參與訓練的時間後段驗證集與目前正式模型比較；只有驗證表現改善才 Promote。
- 正式模型使用的資料量達 300 場後，UI 解除「試判」標記。

### 模型不是修改 learning.js 原始碼

`modules/learning.js` 固定只負責：

1. 讀 `/learning/current-model`。
2. 根據 `current_model.json` 載入目前正式 `model_vXXX.json`。
3. 將當前比賽轉成相同 feature。
4. 顯示「支持／保留／警示」與熱門方勝率。

真正會持續改變的是 R2 中的模型 JSON。訓練工作由 Cloudflare Worker 內的 Training Engine 執行。

### v1 模型特徵

第一代使用可解釋的 Logistic 模型，除了原始數值，也加入使用者最關心的交互項：

- `15項 × 5項`
- `5項 × D`
- `15項 × D`

同時使用 Pinnacle 去水勝率、賠轉勝率、評級勝率、評級 EV、熱門方賠率、D、排名訊號、5項、15項、Main / All 權重等數值。

### 防止同場多次分析灌水

同一個 `match_id` 可以保留多個 Snapshot，但 Training Dataset 中該場所有 Snapshot 的 `sample_weight` 總和固定為 1。Train / Validation 也以 `match_id` 整組切割，不會把同場部分 Snapshot 放進訓練、部分放進驗證。

### R2 新增項目

```text
learning/
  current_model.json
  pending.json
  training_history.json
  last_training_error.json        # 只有訓練錯誤時才會出現
  models/
    model_v001.json
    model_v002.json
    ...
  experience/
    YYYY-MM-DD.json

settlement/
  results/
    YYYY-MM-DD.json
```

### API

- `GET /learning/current-model`：前端固定模型入口。
- `GET /learning/status`：查看覆盤數、Pending、目前模型與下一訓練門檻。
- `POST /learning/settle`：手動執行賽果結算，需要現有 `UPLOAD_TOKEN`。
- `POST /learning/train`：達訓練門檻後可手動觸發一次 Training Engine，需要現有 `UPLOAD_TOKEN`。平常不需要，Cron 結算後會自動檢查是否到門檻。

### Cron

維持台灣時間每日 03:00、15:00：

```text
0 7,19 * * *
```

每次 `scheduled()` 先做 365Scores 結算，再檢查是否達到模型訓練門檻。
