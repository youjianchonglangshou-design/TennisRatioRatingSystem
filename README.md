# 🎾 TennisRatioRatingSystem

https://youjianchonglangshou-design.github.io/TennisRatioRatingSystem/

> **TennisRatio 2.0｜ATP／WTA 勝率、EV、評級與 BO3 全自動分析系統**

本專案是一套完全由瀏覽器端 JavaScript 執行的網球分析系統。

使用者進入 GitHub Pages 後，可以：

- 顯示上一次保存在 Cloudflare R2 的分析結果。
- 按「重新抓取＋完整分析」重新取得 Pinnacle 賠率並完成全部分析。
- 按「只重跑目前清單」保留既有比賽清單，只重新取得外部數據與計算評級。
- 下載 `today_matches.json` 與 `ratio_analysis.json`。
- 使用 Groq Compound 針對指定場次或整批清單進行問答。

---

# 1. 正式檔案結構

```text
index.html
styles.css
app.js

modules/
├─ pinnacle.js
├─ data-services.js
├─ analysis-engine.js
├─ renderer.js
└─ groq-client.js

ratio_config.json
today_matches.json
ratio_analysis.json
.nojekyll
LICENSE
README.md
```

## 1.1 根目錄檔案

### `index.html`

負責：

- 網頁骨架。
- 頁首、操作按鈕、搜尋框、評級篩選膠囊。
- 主表格。
- Groq Compound 側邊欄。
- 模型設定視窗。
- JavaScript 載入順序。

JavaScript 必須依照以下順序載入：

```text
pinnacle.js
data-services.js
analysis-engine.js
renderer.js
groq-client.js
app.js
```

`app.js` 必須最後載入，因為它會使用前面五個模組建立的全域功能。

---

### `styles.css`

負責全部視覺：

- 深色主題。
- 主表格。
- 評級、D 值與排名膠囊。
- Hover 完整分析卡片。
- All Levels／Main Tour 頁籤。
- 六格評級資訊。
- BO3 預測區塊。
- Groq Compound 側邊欄與模型設定視窗。

---

### `app.js`

負責整個系統的操作與流程編排：

- 初次進入頁面時載入上一次結果。
- 重新抓取 Pinnacle。
- 只重跑既有清單。
- 呼叫外部資料管線。
- 呼叫分析引擎。
- 將 JSON 寫入 Cloudflare R2。
- 主表格排序、搜尋、篩選。
- Hover 卡片顯示與定位。
- JSON 下載。
- Groq Compound 側邊欄控制。

目前 `app.js` 需要設定：

```js
const ARCADIA_API_KEY = "你的 Arcadia API Key";

const WORKER_URL =
  "https://你的-worker.workers.dev";

const WORKER_UPLOAD_TOKEN =
  "與 Cloudflare UPLOAD_TOKEN 相同的值";
```

> `app.js` 是前端公開檔案。放在其中的值可被瀏覽器使用者查看，現階段屬於快速測試架構。

---

## 1.2 `modules/` 資料夾

### `modules/pinnacle.js`

負責：

- 呼叫 Arcadia Tennis Matchups API。
- 呼叫 Arcadia Straight Markets API。
- 美式賠率轉十進位賠率。
- 辨識聯賽層級。
- 排除 ITF 與雙打。
- 篩選指定賠率範圍。
- 建立 `today_matches.json`。

---

### `modules/data-services.js`

這支檔案是資料層整合包，內含：

```text
共用姓名、時間、層級與場地工具
365Scores 場地與排名
TennisRatio 賽程與球員數據
TennisRatio 限流機制
排名多來源補位
source_bundle 建立流程
Cloudflare R2 讀寫 Client
```

---

### `modules/analysis-engine.js`

負責：

- 原始 15 項廣度比較。
- Formula B v1.3。
- All Levels／Main Tour 權重混合。
- 五項方向比較。
- D 值。
- 排名情境修正。
- 評級勝率。
- 評級 EV。
- A／B／C／淘汰。
- BO3 機械預測。
- 建立 `ratio_analysis.json`。

---

### `modules/renderer.js`

負責：

- 將 `ratio_analysis.json` 轉成主表格。
- 選手排名膠囊。
- 評級與 D 值膠囊。
- Hover 比賽資訊卡。
- Hover 完整評級卡。
- All Levels／Main Tour 頁籤。
- 評級篩選數量。
- 冷門方候選篩選。

---

### `modules/groq-client.js`

負責：

- 判斷問題是指定場次或整批總覽。
- 指定場次最多傳送 4 場完整資料。
- 整批問題只傳送精簡欄位。
- 保留最近 6 則對話。
- 將問題傳給 Cloudflare Worker `/groq`。
- 接收 Groq Compound 回覆與 Groq Web Search 來源。
- 429／5xx／網路錯誤自動重試。

---

## 1.3 根目錄 JSON

### `ratio_config.json`

系統的正式規則設定檔。

包含：

- Pinnacle 賠率範圍。
- 排除規則。
- Formula B 參數。
- Main Tour 權重參數。
- 排名情境參數。
- A／B／C／淘汰門檻。
- 網路設定參考值。

---

### `today_matches.json`

用途：

- Cloudflare R2 無法讀取時的本地備援。
- 保存比賽、時間、聯賽、主客場與雙方賠率。

正式運作時優先讀取：

```text
Cloudflare R2 / today_matches.json
```

R2 失敗才讀取 GitHub 根目錄的同名檔案。

---

### `ratio_analysis.json`

用途：

- Cloudflare R2 無法讀取時的分析畫面備援。
- 保存每場完整評級、模型數據、比較結果與 BO3 預測。

正式運作時優先讀取：

```text
Cloudflare R2 / ratio_analysis.json
```

---

# 2. 系統整體架構

```text
使用者瀏覽器
│
├─ GitHub Pages
│  ├─ HTML
│  ├─ CSS
│  └─ JavaScript 分析引擎
│
├─ Pinnacle Arcadia
│  └─ 瀏覽器直接抓取比賽與賠率
│
├─ Cloudflare Worker
│  ├─ 代理 365Scores
│  ├─ 代理 TennisRatio
│  ├─ 接收 JSON 上傳
│  ├─ 讀寫 R2
│  └─ 代理 Groq Compound
│
└─ Cloudflare R2
   ├─ matchups.json
   ├─ markets.json
   ├─ today_matches.json
   ├─ source_bundle.json
   ├─ ratio_analysis.json
   ├─ meta.json
   └─ source-cache/
```

---

# 3. 資料來源分工

## 3.1 Pinnacle Arcadia

負責：

- 比賽時間。
- 聯賽名稱。
- ATP／WTA 層級。
- 輪次。
- 主場與客場。
- 雙方賠率。
- 定義熱門方。

熱門方不是主場或客場固定角色，而是：

```text
雙方之中賠率較低者
```

---

## 3.2 365Scores

負責：

- ATP／WTA 主巡迴場地。
- 第一順位 ATP／WTA 世界排名。
- 日清單配對。
- 必要時補讀單場明細。

真正使用的排名欄位：

```text
competitor.rankings[].name
competitor.rankings[].position
```

只接受：

```text
ATP
WTA
```

不使用：

```text
popularityRank
```

---

## 3.3 TennisRatio 賽程

負責：

- ATP／WTA 球員正式姓名辨識。
- 球員 ID。
- H2H URL。
- 第二順位排名。
- ATP Challenger 場地。
- WTA 125 場地。

ATP Challenger／WTA 125 的場地配對規則：

```text
巡迴別相同
＋ 層級相同
＋ 賽事名稱相符
```

輪次只做紀錄與候選排序，不作為場地唯一判定條件。

---

## 3.4 TennisRatio 球員數據

負責最近 52 週、指定場地的：

```text
All Levels
Main Tour
```

主要欄位包括：

- 勝率。
- 保發率。
- 破發率。
- 一發進球率。
- 一發得分率。
- 二發得分率。
- 接一發得分率。
- 接二發得分率。
- 破發點挽救率。
- 破發點轉換率。
- Dominance。
- Match Efficiency。
- 發球壓力。
- 接發壓力。
- 每場雙誤。

Profile 頁面只在其他來源都沒有排名時，才作最後順位排名備援。

---

# 4. 排名來源優先順序

每位球員的排名依序尋找：

```text
1. 365Scores 日清單排名
2. 365Scores 單場明細排名
3. TennisRatio 賽程頁排名
4. Cloudflare R2 快取的 TennisRatio Profile
5. 低速重新抓取 TennisRatio Profile
6. 全部失敗才標記排名缺失
```

主場與客場可以使用不同來源。

例如：

```text
主場排名：365Scores
客場排名：TennisRatio 賽程
```

只要兩個排名都是大於 0 的正整數，Formula B 就能使用。

---

# 5. TennisRatio 限流與快取

## 5.1 前端限流

TennisRatio 請求採單線序列執行：

```text
一次只處理 1 場
→ 一次只處理 1 位球員
→ All Levels 先抓
→ Main Tour 再抓
→ 必要時才抓 Profile
```

每次請求至少間隔：

```text
450 ms
```

遇到 HTTP 429 或 Cloudflare `1015`：

```text
第一次冷卻：10 秒
第二次冷卻：25 秒
第三次冷卻：60 秒
```

連續失敗後才回傳錯誤。

---

## 5.2 Cloudflare R2 快取

### TennisRatio 賽程

```text
新鮮時間：30 分鐘
錯誤時舊資料可備援：6 小時
```

### TennisRatio 統計

```text
新鮮時間：6 小時
錯誤時舊資料可備援：7 天
```

### TennisRatio Profile

```text
新鮮時間：24 小時
錯誤時舊資料可備援：14 天
```

### TennisRatio Directory

```text
新鮮時間：6 小時
錯誤時舊資料可備援：7 天
```

R2 快取路徑：

```text
source-cache/tennisratio/schedule/
source-cache/tennisratio/stats/
source-cache/tennisratio/profile/
source-cache/tennisratio/directory/
```

---

# 6. 進入頁面時的運作流程

使用者進入 GitHub Pages 時，不會自動重新抓取 Pinnacle。

系統同時讀取：

```text
R2 ratio_analysis.json
R2 today_matches.json
R2 source_bundle.json
GitHub ratio_config.json
```

流程：

```text
1. 載入上一次 ratio_analysis.json
2. 載入上一次 today_matches.json
3. 載入 source_bundle.json 健康狀態
4. 載入 ratio_config.json
5. renderer.js 建立主表格與 Hover 卡片
6. 啟用搜尋、排序、篩選與 Groq Compound
```

若 R2 的 `today_matches.json` 或 `ratio_analysis.json` 無法讀取：

```text
改讀 GitHub 根目錄的同名 JSON
```

因此進入頁面只顯示上次結果，不會因為重新整理而大量呼叫外部網站。

---

# 7. 「重新抓取＋完整分析」流程

按下按鈕後：

```text
Phase 2：Pinnacle
Phase 3：外部資料
Phase 4：分析引擎
Phase 5：畫面與 Groq Compound
```

## Phase 2：Pinnacle

```text
瀏覽器同時取得：
matchups
markets
```

接著：

```text
1. 將美式賠率轉成十進位賠率
2. 排除 ITF
3. 排除雙打
4. 篩選 1.50～1.75
5. 辨識 ATP／WTA 層級
6. 依開賽時間排序
7. 建立 today_matches.json
8. 上傳 matchups、markets、today_matches 到 R2
```

---

## Phase 3：外部資料

```text
1. 365Scores 讀取各比賽日期日清單
2. TennisRatio 讀取 ATP／WTA 賽程
3. 每場與 365Scores 配對
4. 取得場地與第一順位排名
5. 取得 TennisRatio 球員 ID 與正式姓名
6. 依序取得 All Levels 與 Main Tour
7. 必要時以 Profile 補排名
8. 建立 source_bundle.json
9. 上傳 R2
```

---

## Phase 4：分析

```text
1. 讀取 ratio_config.json
2. 判斷熱門方
3. 建立 All Levels／Main Tour 權重
4. 建立原始 15 項比較
5. 建立評級 5 項比較
6. 計算 D 值
7. 計算排名情境修正
8. 計算評級勝率
9. 計算評級 EV
10. 判定 A／B／C／淘汰
11. 建立 BO3 預測
12. 建立 ratio_analysis.json
13. 上傳 R2
```

---

## Phase 5：顯示

```text
1. 從 R2 重新讀回 ratio_analysis.json
2. renderer.js 產生表格
3. 更新 A／B／C／淘汰數量
4. 建立 Hover 完整分析卡
5. Groq Compound 載入最新分析上下文
```

---

# 8. 「只重跑目前清單」流程

此按鈕不重新抓取 Pinnacle。

流程：

```text
1. 讀取 R2 現有 today_matches.json
2. 重新抓取／讀取 365Scores 與 TennisRatio
3. 重建 source_bundle.json
4. 重新執行 Formula B
5. 重建 ratio_analysis.json
6. 上傳 R2
7. 更新畫面
```

適用情況：

- Pinnacle 清單沒有改變。
- 只想更新排名、場地或球員統計。
- 前一次 TennisRatio 被限流。
- 修改 `ratio_config.json` 後重新計算。

---

# 9. Pinnacle 比賽篩選規則

## 9.1 賠率範圍

正式設定：

```text
最低：1.50
最高：1.75
```

只要主場或客場其中一方的十進位賠率落在此區間，就保留該場。

範圍包含邊界：

```text
1.500 可以
1.750 可以
```

---

## 9.2 排除比賽

### ITF

聯賽文字包含獨立的：

```text
ITF
```

即排除。

### 雙打

符合任一條件即排除：

- 聯賽名稱包含 `double`、`doubles` 或 `dobles`。
- 主客場選手名稱都含有 `/`。

分析引擎也會再次檢查 ITF 與雙打，形成第二道保護。

---

## 9.3 不排除的類型

目前設定不排除：

```text
ATP Challenger
WTA 125
Qualifying
```

它們仍可進入分析，但 All Levels／Main Tour 權重不同。

---

# 10. 聯賽層級辨識

辨識順序：

```text
1. 聯賽名稱已明確寫出層級
2. Arcadia league ID 對照
3. 賽事名稱對照
4. ATP／WTA 通用 fallback
5. 無法辨識則層級待補
```

可辨識：

```text
Grand Slam
ATP 1000
ATP 500
ATP 250
ATP Challenger
WTA 1000
WTA 500
WTA 250
WTA 125
ITF/Futures
ATP
WTA
```

無法辨識層級時，系統不會猜測 Main Tour 權重，而是：

```text
評級：層級待補
```

---

# 11. All Levels／Main Tour 權重

這是系統最重要的資料選擇規則之一。

## 11.1 基本原則

```text
All Levels
＝該球員最近 52 週、同場地、全部層級比賽

Main Tour
＝該球員最近 52 週、同場地、主巡迴比賽
```

系統不是固定選一個頁籤，而是依賽事層級與雙方 Main 樣本，自動計算混合比例。

---

## 11.2 賽事 Main 係數

| 賽事類型 | 賽事 Main 係數 | 規則 |
|---|---:|---|
| Grand Slam 會內賽 | 100% | 重視 Main Tour |
| ATP 1000／500／250 會內賽 | 100% | 重視 Main Tour |
| WTA 1000／500／250 會內賽 | 100% | 重視 Main Tour |
| 一般 ATP／WTA 會內賽 | 100% | 重視 Main Tour |
| Finals | 100% | 重視 Main Tour |
| 主巡迴資格賽 | 50% | Main／All 折衷 |
| ATP Challenger | 0% | 使用 All Levels |
| WTA 125 | 0% | 使用 All Levels |
| ITF／Futures | 0% | 但目前會先被淘汰 |
| 層級未知 | 0% | 保守使用 All Levels |

### ATP 1000 到底重視什麼？

目前代碼沒有為 ATP 1000 設置額外的排名加成或獨立公式。

ATP 1000 會內賽的特殊點是：

```text
賽事 Main 係數＝100%
```

因此在雙方 Main Tour 樣本足夠時，主要採用 Main Tour 同場地數據。

ATP 500、ATP 250、WTA 1000、WTA 500、WTA 250 的會內賽目前也採相同規則。

差別不在「1000 再額外加分」，而在：

```text
主巡迴會內賽可使用 Main Tour
次級巡迴固定使用 All Levels
```

---

## 11.3 Main 樣本可信度

假設：

```text
H＝熱門方 Main Tour 樣本數
C＝對手 Main Tour 樣本數
```

先計算雙方調和有效樣本：

```text
Main有效樣本 ＝ 2 × H × C ÷ (H + C)
```

再計算樣本可信度：

```text
Main樣本可信度
＝ min(1, Main有效樣本 ÷ 10)
```

最後：

```text
Main權重
＝ 賽事 Main 係數 × Main樣本可信度
```

```text
All Levels權重
＝ 1 − Main權重
```

---

## 11.4 Main 樣本缺失

只要任何一方沒有有效 Main Tour 樣本：

```text
Main權重＝0%
All Levels權重＝100%
```

不會只使用單方 Main 數據。

---

## 11.5 權重範例

### ATP 1000 會內賽，雙方 Main 樣本 19／11

```text
Main有效樣本
＝ 2×19×11÷(19+11)
＝ 13.93

樣本可信度
＝ min(1,13.93÷10)
＝ 100%

Main權重＝100%
All Levels權重＝0%
```

### ATP 1000 會內賽，雙方 Main 樣本 4／11

```text
Main有效樣本
＝ 2×4×11÷15
＝ 5.87

Main權重＝58.7%
All Levels權重＝41.3%
```

### ATP 1000 資格賽，樣本可信度 80%

```text
賽事 Main 係數＝50%

Main權重
＝ 50%×80%
＝ 40%

All Levels權重＝60%
```

### ATP Challenger

```text
賽事 Main 係數＝0%

Main權重＝0%
All Levels權重＝100%
```

---

# 12. 原始 15 項廣度比較

原始比較分別顯示：

```text
All Levels｜同場地
Main Tour｜同場地
```

15 項為：

1. 勝率。
2. 保發率／局。
3. 破發率／局。
4. 一發進球率。
5. 一發得分率。
6. 二發得分率。
7. 接一發得分。
8. 接二發得分。
9. 破發點挽救。
10. 破發點轉換。
11. Dominance。
12. Match Efficiency。
13. 發球壓力。
14. 接發壓力。
15. 雙誤／場。

判斷方向：

```text
雙誤／場：數值越低越好
其餘 14 項：數值越高越好
```

平手：

```text
雙方都不加分
```

樣本數只顯示，不算入 15 項。

## 15 項的功能

15 項用來觀察：

```text
廣度
```

它讓使用者知道雙方在更多細項上，誰的優勢較全面。

但目前正式評級門檻不是直接用 15 項數量決定，而是使用下面的五項方向與 EV。

---

# 13. 評級五項

Formula B 將數據整理為五個方向：

| 項目 | 內容 | 權重 |
|---|---|---:|
| 近期勝率 | 雙方混合勝率差 | 30% |
| 保發與破發能力 | 保發率＋破發率 | 30% |
| 發球與接發得分 | 一發、二發、接一發、接二發 | 15% |
| 破發點表現 | 挽救率＋轉換率 | 10% |
| 整體比賽效率 | Dominance × Match Efficiency | 15% |

五項中：

```text
熱門方值 > 對手值
→ 熱門方支持 1 項
```

```text
熱門方值 < 對手值
→ 對手支持 1 項
```

```text
雙方相同
→ 平手，不增加熱門方支持
```

五項主要功能：

```text
決定支持方向
限制評級最高上限
決定排名訊號如何作用
```

---

# 14. D 值計算

D 值是五個數據方向的加權總和。

令：

```text
熱門方＝Pinnacle 低賠方
對手＝另一方
```

## 14.1 勝率項

```text
D_win
＝ 0.30 × (熱門方勝率 − 對手勝率) ÷ 10
```

---

## 14.2 保發與破發項

```text
熱門方局能力
＝ 熱門方保發率＋熱門方破發率

對手局能力
＝ 對手保發率＋對手破發率
```

```text
D_game
＝ 0.30 × (熱門方局能力 − 對手局能力) ÷ 10
```

---

## 14.3 發球與接發得分項

```text
發接得分合計
＝ 一發得分率
＋ 二發得分率
＋ 接一發得分率
＋ 接二發得分率
```

```text
D_point
＝ 0.15 × (熱門方合計 − 對手合計) ÷ 20
```

---

## 14.4 破發點項

```text
破發點合計
＝ 破發點挽救率＋破發點轉換率
```

```text
D_breakpoint
＝ 0.10 × (熱門方合計 − 對手合計) ÷ 10
```

---

## 14.5 整體效率項

```text
整體效率
＝ Dominance × Match Efficiency
```

```text
D_efficiency
＝ 0.15 × ln(熱門方整體效率 ÷ 對手整體效率)
```

---

## 14.6 最終 D

```text
D
＝ D_win
＋ D_game
＋ D_point
＋ D_breakpoint
＋ D_efficiency
```

D 的方向：

```text
D > 0：數據偏熱門方
D < 0：數據偏對手／冷門方
D = 0：數據中性
```

---

# 15. D 值膠囊

畫面上的 D 顯示規則：

| 顯示 | D 值 | 意義 |
|---|---:|---|
| D++ | D > 0.4 | 明顯偏熱門方 |
| D+ | 0 < D ≤ 0.4 | 偏熱門方 |
| D0 | D = 0 或無有效 D | 中性／不足 |
| D- | -0.4 ≤ D < 0 | 偏冷門方 |
| D-- | D < -0.4 | 明顯偏冷門方 |

D 值本身不是 A／B／C 的直接門檻。

它會先進入 Formula B，經過 `tanh` 壓縮後影響評級勝率。

---

# 16. 排名訊號

排名數字越小代表排名越前。

令：

```text
HotRank＝熱門方排名
ColdRank＝對手排名
```

## 16.1 排名差 R

```text
R ＝ ln(ColdRank ÷ HotRank)
```

因此：

```text
熱門方排名較前 → R > 0
熱門方排名較後 → R < 0
```

---

## 16.2 排名可信度 Q

```text
Q
＝ 50 ÷ (50＋雙方較前的排名)
```

也就是：

```text
Q ＝ 50 ÷ (50＋min(HotRank,ColdRank))
```

排名越接近頂尖區域，Q 越高；排名越後，排名訊號越被壓低。

---

## 16.3 原始排名訊號

```text
原始排名訊號
＝ 3.8 × Q^2.5 × R
```

原始排名訊號不會直接全數加入模型，而是依五項方向套用排名情境。

---

# 17. 排名情境規則

## 17.1 熱門方排名較前，但五項只支持 0～2 項

情境：

```text
排名救援
```

保留原始排名正向訊號：

| 熱門方五項支持 | 保留比例 |
|---:|---:|
| 0／5 | 20% |
| 1／5 | 36% |
| 2／5 | 52% |

意思：

> 排名可以救援數據較差的熱門方，但不能完全覆蓋五項數據。

---

## 17.2 熱門方排名較前，五項支持 3～5 項

情境：

```text
排名確認
```

因為數據本身已經支持熱門方，所以不再給完整排名加分。

先取：

```text
原始排名訊號 × 10%
```

上限：

```text
0.35
```

再乘五項支持率：

```text
3／5 → 60%
4／5 → 80%
5／5 → 100%
```

目的：

> 避免熱門方同時擁有好排名與好數據時，排名被重複放大。

---

## 17.3 熱門方排名較後，五項只支持 0～2 項

情境：

```text
放棄區
```

規則：

```text
保留 100% 排名負向扣分
```

不啟動排名救援。

---

## 17.4 熱門方排名較後，但五項支持 3～5 項

情境：

```text
數據逆排名
```

讓數據抵銷部分排名疑慮：

| 熱門方五項支持 | 保留排名負向扣分 |
|---:|---:|
| 3／5 | 80% |
| 4／5 | 60% |
| 5／5 | 40% |

意思：

> 熱門方雖然排名較後，但若場地數據足夠好，不讓排名差完全否定它。

---

## 17.5 雙方排名相同

```text
排名修正＝0
```

只使用市場基準與雙方數據。

---

# 18. Pinnacle 去水勝率

## 18.1 賠轉勝率

畫面中的「賠轉勝率」：

```text
1 ÷ 熱門方賠率
```

這個值未去除莊家水位。

---

## 18.2 去水勝率

令：

```text
HotOdds＝熱門方賠率
ColdOdds＝對手賠率
```

```text
熱門方隱含率＝1÷HotOdds
對手隱含率＝1÷ColdOdds
```

```text
P0
＝ 熱門方隱含率
÷ (熱門方隱含率＋對手隱含率)
```

`P0` 是 Formula B 的市場基準。

---

# 19. 評級勝率 Formula B

## 19.1 數據與排名訊號

```text
B訊號
＝ D ＋ 情境化排名修正
```

使用：

```text
tanh(B訊號)
```

將極端值壓縮，避免單一項目造成無限放大。

---

## 19.2 最終公式

```text
評級勝率
＝ Clamp(
    Pinnacle去水勝率
    ＋ 0.023
    ＋ 0.031 × tanh(D＋情境化排名修正),
    50%,
    80%
  )
```

其中：

```text
固定基準加值＝2.3 個百分點
數據排名最大調整尺度＝3.1 個百分點
最低勝率＝50%
最高勝率＝80%
```

注意：

- 評級勝率以 Pinnacle 去水市場為基準。
- D 與排名只作有限幅度修正。
- 模型不是完全脫離市場自行估勝率。
- 評級勝率是熱門方勝率，不進行主客場反轉。

---

# 20. 評級公平賠率

```text
評級公平賠率
＝ 1 ÷ 評級勝率
```

例如：

```text
評級勝率 65%
→ 公平賠率約 1.538
```

---

# 21. 評級 EV

```text
評級EV
＝ 評級勝率 × 熱門方賠率 − 1
```

百分比：

```text
評級EV百分比
＝ 評級EV × 100%
```

例如：

```text
評級勝率＝65%
熱門方賠率＝1.60

EV
＝ 0.65×1.60−1
＝ +0.04
＝ +4%
```

---

# 22. A／B／C／淘汰門檻

評級採兩道門檻：

```text
第一道：EV 等級
第二道：五項支持最高上限
```

最終評級取兩者較低者。

---

## 22.1 EV 等級

| 評級 | 評級 EV |
|---|---:|
| A | EV ≥ 7% |
| B | EV ≥ 4% |
| C | EV > 0% |
| 淘汰 | EV ≤ 0% |

---

## 22.2 五項支持上限

| 熱門方五項支持 | 評級最高上限 |
|---:|---|
| 5／5 | A |
| 4／5 | B |
| 3／5 | C |
| 0～2／5 | 淘汰 |

---

## 22.3 最終評級

```text
最終評級
＝ EV 等級與五項上限兩者較低
```

範例：

### EV 8%，五項 4／5

```text
EV 等級＝A
五項上限＝B
最終評級＝B
```

### EV 5%，五項 5／5

```text
EV 等級＝B
五項上限＝A
最終評級＝B
```

### EV 2%，五項 3／5

```text
EV 等級＝C
五項上限＝C
最終評級＝C
```

### EV 8%，五項 2／5

```text
EV 等級＝A
五項上限＝淘汰
最終評級＝淘汰
```

### 評級勝率 70%，但 EV 為負

```text
最終仍可能淘汰
```

因為：

```text
評級勝率不直接決定 A／B／C
```

評級勝率只用於：

- 計算 EV。
- 顯示熱門方勝率參考。
- BO3 機械預測。

---

# 23. 「15 項、5 項、D、EV」的角色

```text
15 項看廣度
5 項決定支持方向
D 值看數據差距與方向
排名情境修正排名作用
評級勝率將市場、數據與排名整合
EV 決定價格是否值得
五項支持限制最高評級
```

可以簡化成：

> **15 項看得廣；5 項定方向；D 看差距；EV 定價格；最終評級取 EV 與五項的最低門檻。**

---

# 24. 冷門方候選規則

畫面「冷門方」篩選目前使用以下條件：

```text
D < 0
熱門方五項較優數＝0
評級為 C 或包含淘汰
熱門方賠率介於 1.50～1.75
```

符合後標記為冷門方候選。

這是畫面篩選標記，不會另行改寫 Formula B 勝率或最終評級。

---

# 25. 資料不足與待補狀態

## 25.1 層級待補

```text
Pinnacle 賽事層級無法辨識
```

為避免錯誤混用 Main／All，不執行評級。

---

## 25.2 場地待補

```text
無法取得 Hard／Clay／Grass
```

不執行同場地數據分析。

---

## 25.3 資料不足：球員無法確認

```text
至少一位球員無法由 TennisRatio 確認
```

即使 365Scores 有排名，若 TennisRatio 找不到球員統計，仍不能完成 Formula B。

---

## 25.4 資料不足：All Levels 樣本缺失

只要任一球員沒有有效的同場地 All Levels 樣本：

```text
Formula B 不計算
```

All Levels 是必需資料。

Main Tour 是可選資料。

---

## 25.5 資料不足：Formula B 無法計算

包括：

- 任一排名缺失。
- 必要數值不是數字。
- 樣本數不大於 0。
- Dominance 不大於 0。
- Match Efficiency 不大於 0。
- 雙方賠率無效。

---

# 26. 過期規則

比賽時間加 15 分鐘後，系統標記：

```text
已過期＝true
```

若原評級是淘汰：

```text
淘汰＋過期
```

若資料不足類型在過期後處理：

```text
過期
```

過期不會阻止系統繼續補抓 TennisRatio 資料。

---

# 27. BO3 機械預測

BO3 模型使用：

```text
評級勝率
雙方混合保發率
雙方混合破發率
```

流程：

```text
1. 由評級勝率反推熱門方單盤勝率
2. 將雙方歷史保發／破發交叉
3. 校準熱門方保發與破發強度
4. 建立每盤局數分布
5. 計算搶七機率
6. 精確計算 2:0、2:1、1:2、0:2
7. 計算兩盤／三盤機率
8. 計算預估總局數
```

BO3 不使用隨機抽樣。

熱門方單盤勝率记為 `p` 時，基本盤數機率為：

```text
熱門方 2:0 ＝ p²
熱門方 2:1 ＝ 2×p²×(1−p)
對手 2:1 ＝ 2×p×(1−p)²
對手 2:0 ＝ (1−p)²
```

實際 `p` 會再由保發／破發模型校準。

---

# 28. Groq Compound 運作方式

```text
GitHub Pages
→ POST /groq
→ Cloudflare Worker
→ Worker Secret：GROQ_API_KEY
→ Google Groq Compound
→ 回傳答案與搜尋來源
```

## 指定場次問題

例如：

```text
項次 3 如何？
Berrettini 這場怎麼看？
```

最多傳送：

```text
4 場完整資料
```

---

## 整批問題

例如：

```text
目前有多少 A 級？
列出 EV 最高的比賽
```

傳送全部比賽的精簡欄位，不傳整份巢狀 JSON。

---

## 外網使用

Groq Web Search 只用於查證：

- 傷病。
- 退賽。
- 官方公告。
- 近期賽程。
- 旅行疲勞。
- 即時狀態。

系統內的：

```text
賠率
評級勝率
EV
D 值
五項結果
```

必須以 `ratio_analysis.json` 為準，Groq Compound 不得自行捏造。

---

# 29. Cloudflare 設定

## R2 Binding

```text
Variable name：JSON_BUCKET
R2 bucket：tennis-json
```

## Secrets

```text
UPLOAD_TOKEN
GROQ_API_KEY
```

`UPLOAD_TOKEN` 必須與 `app.js` 的 `WORKER_UPLOAD_TOKEN` 相同。

---

# 30. R2 主要檔案

| 檔案 | 內容 |
|---|---|
| `matchups.json` | Pinnacle 原始比賽 |
| `markets.json` | Pinnacle 原始賠率市場 |
| `today_matches.json` | 篩選後比賽清單 |
| `source_bundle.json` | 365Scores＋TennisRatio 整合資料 |
| `ratio_analysis.json` | 最終分析結果 |
| `meta.json` | 更新時間與檔案資訊 |

---

# 31. 下載按鈕

## 下載 Pinnacle JSON

下載目前記憶體或 R2 的：

```text
today_matches.json
```

## 下載 Ratio JSON

下載目前記憶體或 R2 的：

```text
ratio_analysis.json
```

使用瀏覽器 Blob 下載，不會開啟 JSON 新分頁。

---

# 32. 建議操作順序

## 每次一般使用

```text
1. 開啟 GitHub Pages
2. 先查看上一次結果
3. 需要最新賠率時按「重新抓取＋完整分析」
4. 等待全部流程完成
5. 不要在執行中重複按按鈕
```

## 賠率清單不變，只更新數據

```text
按「只重跑目前清單」
```

## TennisRatio 曾出現 429／1015

```text
不要連續重複執行
等待冷卻後再只重跑目前清單
```

---

# 33. 修改規則的位置

## 賠率範圍

```text
ratio_config.json
odds_range
```

但目前 `app.js` 執行 Pinnacle 時也明確傳入：

```text
minOdds: 1.5
maxOdds: 1.75
```

若要改賠率範圍，應同步檢查 `app.js` 與 `ratio_config.json`。

---

## Formula B

```text
ratio_config.json
formula_b
```

---

## 評級門檻

```text
ratio_config.json
rating
```

---

## 聯賽層級對照

```text
modules/pinnacle.js
modules/data-services.js
```

---

## 畫面與卡片

```text
styles.css
modules/renderer.js
app.js 的 placeCard()
```

---

# 34. 核心規則摘要

```text
熱門方
＝ Pinnacle 低賠方

市場基準
＝ Pinnacle 雙方賠率去水後的熱門方勝率

All／Main
＝ 賽事層級係數 × 雙方 Main 調和有效樣本可信度

15 項
＝ 顯示雙方數據廣度

五項
＝ 決定數據支持方向與評級最高上限

D
＝ 五項數據的加權差距

排名
＝ 依排名方向與五項支持情境化處理

評級勝率
＝ 市場基準＋固定加值＋有限數據排名修正

EV
＝ 評級勝率×熱門方賠率−1

最終評級
＝ EV 等級與五項支持上限取較低者
```

---

# 35. 版本基準

本說明書依目前程式規則整理：

```text
Formula B v1.3
BO3 Mechanical v1.0
APP_VERSION 4.4.9-strict-five-support-rating
資料管線 3.1-rank-fallback-rate-limit
前端結構 structure-v2-modules
```

最後更新：

```text
2026-08-03（Asia/Taipei）
```

---

# 外部資訊與風險覆核｜External Risk v1.3

評級完成後，系統只掃描尚未過期的：

```text
A 級
B 級
```

Groq Compound＋Groq Web Search 負責查詢熱門方的：

- 近期傷病、疾病、醫療暫停。
- 退賽、傷退與官方狀態。
- 上一場比賽耗時與短休連戰。
- 密集賽程與跨城市／跨洲移動。
- 訓練、近期狀態與選手本人發言。
- 其他結構化數據無法呈現的近期資訊。

## 核心原則：資訊不能被分類系統隱藏

外部覆核分為兩層：

```text
第一層
＝搜尋到什麼

第二層
＝系統如何判斷
```

即使 Groq Compound 無法確定資訊是否構成風險，只要已經取得搜尋內容或來源，就必須保存到：

```text
findings
raw_search_text
sources
```

不得因分類失敗而刪除或隱藏資訊。

---

## 五種正式狀態

### `risk_found`

```text
圖示：紅色 !!
```

代表：

```text
找到有日期、有來源、
與目前熱門方相符、
而且可能直接影響本場的明確不利資訊
```

點擊後顯示：

- 全部不利資訊。
- 事件日期。
- 與本場的可能關係。
- Groq Compound 搜尋整理。
- 查證來源。
- 搜尋時間與可信度。

快取：

```text
6 小時
```

紅色 `!!` 只作外部覆核，不會自動修改 A／B 評級。

---

### `clear`

```text
圖示：無
```

代表：

```text
搜尋已成功完成
而且沒有找到值得呈現的近期異常或狀態資訊
```

`clear` 必須具備 Groq Web Search 搜尋紀錄。

若已找到具體資訊，就不能使用 `clear` 隱藏，必須改成：

```text
manual_review
```

快取：

```text
6 小時
```

---

### `manual_review`

```text
圖示：灰藍色 i
```

代表：

```text
已找到具體近期資訊
但不足以確定為明確風險
或正面、負面與中性資訊混合
```

這個狀態的目的不是替人類下結論，而是把所有搜尋資訊完整交還使用者。

點擊灰藍色 `i` 後顯示：

- 搜尋到的全部資訊。
- 日期與事件。
- 與本場的可能關係。
- Groq Compound 原始搜尋整理。
- 所有可用來源。
- 系統為什麼沒有列為紅色風險。

例如：

```text
前一場打滿三盤
最近完成跨城市移動
正常參加賽前訓練
選手表示身體狀況良好
近期曾接受醫療暫停
```

即使系統無法判斷它們是否足以影響本場，資訊仍會呈現，由人類自行體會與判讀。

快取：

```text
6 小時
```

---

### `search_incomplete`

```text
圖示：灰色 ↻
```

代表：

```text
本場外部搜尋沒有完整完成
```

可能原因：

- Groq Compound 暫時達到使用量上限。
- 網路逾時。
- 外部服務沒有回應。
- 沒有取得可供人工判讀的搜尋內容。
- Groq Compound 回覆無法整理，而且沒有可靠搜尋來源可保留。

灰色 `↻`：

```text
不代表球員有風險
也不代表已確認安全
只代表下次重新分析需要重試
```

快取：

```text
0 小時
```

下次按：

```text
重新抓取＋完整分析
只重跑目前清單
```

會立即重新嘗試。

---

### `system_error`

```text
球員姓名旁：不顯示任何圖示
頁首：顯示系統錯誤
```

代表：

- Groq Compound API Key 錯誤。
- HTTP 401／403。
- Cloudflare Worker 權限錯誤。
- 系統驗證設定不完整。

這些都是系統問題，不是球員問題，因此不能把警示掛在任何一位球員名字旁。

頁首顯示：

```text
外部風險系統錯誤｜API Key／權限
```

並停止整批外部掃描，避免產生誤導圖示。

快取：

```text
0 小時
```

---

## 圖示總表

```text
紅色 !!
＝明確不利資訊

灰藍色 i
＝有找到資訊，交給人類自行判讀

灰色 ↻
＝搜尋尚未完成，下次重新分析重試

沒有圖示
＝搜尋完成，沒有找到相關異常資訊

頁首系統錯誤
＝API Key、權限或 Worker 設定問題
```

---

## Groq Compound 判斷規則

### 紅色 `!!` 門檻

必須同時符合：

```text
可信度 ≥ 72%
至少一項具體資訊
至少一個 YYYY-MM-DD 日期
至少一個 Groq Web Search 來源
有風險摘要
有本場影響說明
```

任何一項不足，但已有搜尋資訊：

```text
不丟棄
→ 改成 manual_review
→ 顯示灰藍色 i
```

---

## `external_risk.json` 每場主要欄位

```text
status
search_completed
summary
impact
findings
raw_search_text
sources
web_search_queries
confidence
failure_type
http_status
retry_after_seconds
cache_hours
cache_until
used_cache
checked_at
technical_error
```

### `findings`

保存結構化資訊：

```json
{
  "date": "2026-08-03",
  "category": "fatigue",
  "title": "前一場打滿三盤",
  "fact": "上一場耗時 2 小時 46 分",
  "relevance": "距本場時間較短，可能影響恢復",
  "direction": "neutral"
}
```

### `raw_search_text`

當 Groq Compound 找到資訊但無法完整分類時，保存原始搜尋整理，讓使用者仍能閱讀，不會被系統閘門擋掉。

---

## R2 快取

符合以下條件才沿用快取：

```text
match_key 相同
熱門方相同
評級相同
狀態為 risk_found／clear／manual_review
checked_at 未超過 6 小時
```

以下狀態不使用六小時快取：

```text
search_incomplete
system_error
```

---

## 頁首狀態範例

全部完成：

```text
外部風險完成 11/11｜警示 2｜人工判讀 4
```

部分搜尋未完成：

```text
外部風險部分完成 8/11｜警示 1｜人工判讀 3｜未完成 3
```

系統設定錯誤：

```text
外部風險系統錯誤｜API Key／權限｜已完成 4/11
```

---

## 外部資訊的定位

外部資訊不會改寫 Formula B，也不會直接改變 A／B／C／淘汰。

```text
ratio_analysis.json
＝固定公式、可重現的機械分析

external_risk.json
＝即時搜尋、人工判讀與數據外資訊
```

最後判讀方式：

```text
A／B＋無圖示
＝機械評級達標，外部搜尋未找到相關異常

A／B＋紅色 !!
＝機械評級達標，但有明確外部風險

A／B＋灰藍色 i
＝機械評級達標，且有值得人工閱讀的外部資訊

A／B＋灰色 ↻
＝外部搜尋尚未完成，不能視為已覆核
```

---

## 版本

```text
External Risk v1.3
Information-first
```

最後更新：

```text
2026-08-03（Asia/Taipei）
```

---

## Hotfix 7｜何時才顯示灰色 `↻`

灰色 `↻` 僅限於系統完全沒有取得可供閱讀的內容：

```text
Groq Compound HTTP 429／使用量上限
網路連線失敗
連線逾時
外部服務沒有回覆
回覆中沒有任何可閱讀文字
```

以下情況不得再顯示灰色 `↻`：

```text
Groq Compound 有回覆文字，但沒有 Groq Web Search 來源
Groq Compound 回覆不是指定結構
Groq Compound 表示未發現風險，但沒有附上來源
系統無法確定回覆是否足以構成風險
```

只要有任何可閱讀內容：

```text
→ status = manual_review
→ 顯示灰藍色 i
→ 保存 raw_search_text
→ 保存可用的 sources 與查詢紀錄
→ 交給使用者自行判讀
```

### `clear` 的嚴格條件

```text
搜尋成功
＋ 有 Groq Web Search 查詢或來源紀錄
＋ 沒有任何值得呈現的近期資訊
```

才可以：

```text
status = clear
→ 不顯示圖示
```

Groq Compound 回覆「沒有風險」但沒有來源時：

```text
不視為 clear
不視為 search_incomplete
→ 改為 manual_review
→ 顯示灰藍色 i
```

### 進度文字

掃描時顯示：

```text
已處理 11/11
```

「已處理」只代表 11 場都已經執行過一次，不等於 11 場全部成功。

掃描結束後，頁首才使用：

```text
外部風險完成
外部風險部分完成
外部風險系統錯誤
```

區分真正完成、需要重試與系統錯誤。

---

# 三個分析按鈕與 API 分工

## `重新抓取＋完整分析`

```text
Arcadia matchups／markets
→ 建立 today_matches.json
→ 365Scores＋TennisRatio
→ 建立 source_bundle.json
→ Formula B／15項／5項／D值／EV／評級
→ 建立 ratio_analysis.json
→ 執行「分析風險」
→ 更新 external_risk.json
```

會使用：

```text
Arcadia API
365Scores
TennisRatio
Groq Compound／Groq Web Search
Cloudflare R2
```

適合比賽清單或賠率需要更新時使用。

---

## `只重跑目前清單`

```text
R2 today_matches.json
→ 365Scores＋TennisRatio
→ 重新建立 source_bundle.json
→ 重新建立 ratio_analysis.json
→ 執行「分析風險」
→ 更新 external_risk.json
```

不重新抓：

```text
Arcadia matchups／markets
```

但仍會重新呼叫：

```text
365Scores
TennisRatio
Groq Compound／Groq Web Search
```

適合比賽與賠率清單不變，但需要重新分析球員數據和評級時使用。

---

## `分析風險`

```text
R2 ratio_analysis.json
→ R2 external_risk.json 六小時快取
→ 篩選尚未過期的 A／B 熱門方
→ Groq Compound／Groq Web Search 外部資訊覆核
→ 更新 external_risk.json
```

不會呼叫：

```text
Arcadia API
Pinnacle 賠率抓取
365Scores
TennisRatio
source_bundle 重建
Formula B 重算
```

因此需要重新處理灰色 `↻`、更新即時外部消息，或只檢查傷病／疲勞／賽程時，不必重新抓取前面的網站資料。

---

## 三條管線共用同一個終點

```text
重新抓取＋完整分析
        ┐
只重跑目前清單
        ├→ 分析風險
分析風險
        ┘
```

新的 `ratio_analysis.json` 建立後，前兩個按鈕會直接呼叫與第三個按鈕相同的共用風險分析函式。

因此：

```text
風險規則只有一份
快取判定只有一份
external_risk.json 寫入流程只有一份
```

---

## 開啟網頁時

開啟或重新整理網頁只讀取 R2 既有資料：

```text
ratio_analysis.json
today_matches.json
source_bundle.json
external_risk.json
```

不會自動呼叫 Groq Compound。

只有按下以下任一按鈕才會啟動外部風險分析：

```text
重新抓取＋完整分析
只重跑目前清單
分析風險
```

---

## 建議操作

```text
比賽清單或賠率改變
→ 重新抓取＋完整分析

清單不變，但需要更新球員數據與評級
→ 只重跑目前清單

ratio_analysis 已正確，只需要更新外部資訊
→ 分析風險
```

---

---

# Groq Compound 語言模型

## 固定設定

```text
API URL
https://api.groq.com/openai/v1/chat/completions

模型
groq/compound

Cloudflare Worker Secret
GROQ_API_KEY
```

`gsk_` 開頭的金鑰不得寫入：

```text
app.js
index.html
GitHub
README.md
```

必須存放在 Cloudflare Worker 的加密 Secret：

```text
Workers & Pages
→ tennis-json-store
→ Settings
→ Variables and secrets
→ Add
→ Secret
```

名稱填：

```text
GROQ_API_KEY
```

Value 填入完整的 `gsk_...` 金鑰。

---

## 架構

```text
GitHub Pages
→ POST Cloudflare Worker /groq
→ Cloudflare Worker 加入 GROQ_API_KEY
→ POST https://api.groq.com/openai/v1/chat/completions
→ groq/compound
→ 回傳網頁
```

瀏覽器永遠不會直接取得 Groq API Key。

---

## Groq Compound 的用途

`groq/compound` 會依問題自動決定是否使用內建工具，例如：

```text
Web Search
Visit Website
Code Execution
Wolfram Alpha
```

TennisRatio 使用它執行：

```text
網球分析問答
熱門方外部風險搜尋
傷病與退賽查證
近期賽程與疲勞查證
旅行與官方消息查證
```

---

## 一般問答

側邊欄固定顯示：

```text
TennisRatio Groq
groq/compound
```

系統送出：

```text
system
＝ TennisRatio 規則＋問題所需 JSON

user
＝ 使用者問題

model
＝ groq/compound
```

若 Compound 使用 Web Search，系統會整理：

```text
回答內容
搜尋查詢
引用來源
executed_tools
```

並在回答下方顯示可解析的來源網址。

---

## 外部風險分析

```text
ratio_analysis.json
→ 篩選未過期 A／B
→ groq/compound
→ 內建 Web Search
→ external_risk.json
```

外部風險仍沿用五種狀態：

```text
risk_found
→ 紅色 !!
→ 明確不利資訊

clear
→ 無圖示
→ 搜尋完成且沒有相關異常

manual_review
→ 灰藍色 i
→ 有資訊，交給人類判讀

search_incomplete
→ 灰色 ↻
→ 搜尋未完成，下次重試

system_error
→ 不標記球員
→ 顯示在頁首
```

---

## JSON 輸出

外部風險要求 Groq 回傳：

```text
response_format = json_object
```

並由前端再次驗證：

```text
status
severity
confidence
summary
impact
findings
notes
raw_summary
```

若 Groq 有回覆資訊但格式無法直接使用：

```text
先執行一次格式修復
→ 修復成功：正常分類
→ 修復失敗但有可讀資訊：manual_review
→ 完全沒有內容：search_incomplete
```

資訊不能因格式問題被隱藏。

---

## API Key 輪替（選用）

Worker 同時支援：

```text
GROQ_API_KEY
GROQ_API_KEY_2
GROQ_API_KEY_3
GROQ_API_KEY_4
GROQ_API_KEY_5
```

目前只有一把金鑰時，只設定：

```text
GROQ_API_KEY
```

即可。

遇到：

```text
HTTP 429
→ 暫停目前 Key
→ 嘗試下一把

HTTP 401／403
→ 暫停失效 Key
→ 嘗試下一把
```

---

## 三個按鈕

```text
重新抓取＋完整分析
→ Arcadia
→ today_matches
→ 365Scores／TennisRatio
→ ratio_analysis
→ Groq 外部風險

只重跑目前清單
→ R2 today_matches
→ 365Scores／TennisRatio
→ ratio_analysis
→ Groq 外部風險

分析風險
→ R2 ratio_analysis
→ Groq 外部風險
```

只有「分析風險」不會重新抓取 Arcadia、365Scores 或 TennisRatio。

---

## 舊 Gemini 設定

Groq 版不再使用：

```text
GEMINI_API_KEY
GEMINI_API_KEY_2～5
Gemini 模型自動選擇
Google generateContent API
```

確認 Groq 正常後，可從 Cloudflare Worker 刪除舊的 Gemini Secrets。

瀏覽器若保存舊模型設定，Groq 版會保留原本自訂系統提示詞，但模型固定改成：

```text
groq/compound
```

---

## Worker Health

開啟：

```text
https://tennis-json-store.youjianchonglangshou.workers.dev/health
```

應看到類似：

```json
{
  "ai_provider": "Groq",
  "groq_proxy": true,
  "groq_model": "groq/compound",
  "groq_key_pool": 1,
  "groq_key_rotation": true,
  "groq_compound_web_search": true
}
```

---

## 版本

```text
TennisRatio Groq Compound v1
```

最後更新：

```text
2026-08-03（Asia/Taipei）
```

