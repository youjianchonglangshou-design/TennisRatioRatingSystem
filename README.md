# TennisRatio 2.0｜Gemini 2.5 Flash 搜尋版

這個版本保留原本的 Pinnacle、365Scores、TennisRatio、Formula B、15項、5項、D值、EV、BO3、評級卡片與 R2 流程，只替換 AI 與外部風險模組。

## 一、正式 AI 分工

```text
系統內評級、數量、EV、項次與排行問題
→ JavaScript 直接回答
→ 0 次 AI API

A／B 熱門方外部風險
→ gemini-2.5-flash
→ Google Search Grounding
→ 搜尋、判讀、繁體中文整理一次完成

需要解釋評級、模型與場次結構
→ gemini-2.5-flash
→ 不啟用 Google Search
```

Groq、Tavily、Gemini Flash-Lite 均不再使用。

---

# 二、檔案結構

```text
index.html
styles.css
app.js
README.md
ratio_config.json
ratio_analysis.json
today_matches.json

modules/
├─ pinnacle.js
├─ data-services.js
├─ analysis-engine.js
├─ renderer.js
└─ ai-services.js
```

## `modules/ai-services.js`

負責：

```text
JavaScript 直接回答
Gemini 深入追問
Gemini Google Search 外部風險
A／B＋65%資格判定
6小時快取
同一熱門方去重
外部風險狀態與來源整理
```

舊檔已停用：

```text
modules/groq-client.js
modules/gemini-client.js
```

---

# 三、三個操作按鈕

## `重新抓取＋完整分析`

```text
Arcadia matchups／markets
→ 建立 today_matches.json
→ 365Scores＋TennisRatio
→ 建立 source_bundle.json
→ Formula B／15項／5項／D值／EV／評級
→ 建立 ratio_analysis.json
→ 執行分析風險
→ 更新 external_risk.json
```

## `只重跑目前清單`

```text
R2 today_matches.json
→ 365Scores＋TennisRatio
→ 重新建立 source_bundle.json
→ 重新建立 ratio_analysis.json
→ 執行分析風險
→ 更新 external_risk.json
```

不重新抓 Arcadia 賠率清單。

## `分析風險`

```text
R2 ratio_analysis.json
→ R2 external_risk.json 快取
→ 篩選符合資格的 A／B
→ Gemini 2.5 Flash＋Google Search
→ 更新 external_risk.json
```

不會呼叫：

```text
Arcadia
365Scores
TennisRatio
Formula B 重算
```

適合只更新外部傷病、退賽、短休與近期狀態消息。

---

# 四、Pinnacle 與清單規則

預設低賠範圍：

```text
1.50～1.75
```

排除：

```text
Doubles
ITF Futures
```

目前保留：

```text
ATP／WTA 主巡迴賽
ATP Challenger
WTA 125
資格賽
```

實際設定以 `ratio_config.json` 為準。

---

# 五、Formula B 與評級結構

核心概念：

```text
15項看廣度
5項決定支持方向
D值看差距強度
EV決定價格是否值得
```

評級由三道門檻共同決定，最後取最低可達等級：

```text
EV 等級
＋ 五項支持上限
＋ A／B評級勝率65%門檻
```

## A 級

必須同時符合：

```text
評級勝率 ≥ 65%
評級EV ≥ 7%
五項支持 5/5
```

## B 級

必須同時符合：

```text
評級勝率 ≥ 65%
評級EV ≥ 4%
五項支持至少 4/5
未達 A 級
```

## C 級

```text
評級EV > 0%
五項支持至少 3/5
未達 A／B 完整條件
```

## 淘汰

```text
評級EV ≤ 0%
或
五項支持 ≤ 2/5
```

## 65%硬門檻

```text
65.00% → 通過
64.99% → 不通過
```

若原本 EV 與五項可達 A／B，但評級勝率低於 65%：

```text
A／B最高降為 C
```

設定位置：

```json
{
  "rating": {
    "AB_probability_min_pct": 65.0
  }
}
```

---

# 六、外部風險進入條件

必須同時符合：

```text
評級為 A 或 B
評級勝率 ≥ 65%
比賽尚未過期
熱門方姓名存在
```

不符合資格的場次不會消耗 Gemini Search 額度。

---

# 七、Gemini 2.5 Flash 搜尋範圍

每位熱門方只查三類資訊：

## 1. 是否連續多場比賽（過去 7～10 天）

檢查的是「本場比賽前 7～10 天」這個時間範圍內，球員是否已經短時間密集、連續出賽多場；不是指球員必須連續比賽 7～10 天。

```text
最近 7～10 天內是否連續出賽多場
是否休息時間過短
上一場是否耗時異常
是否出現明確短休或體能問題
```

## 2. 最近 90 天公開健康消息

```text
傷病
疾病
退賽
傷退
醫療暫停
官方身體狀態說明
```

## 3. 最近 3～5 場狀態異常

```text
明顯連敗
移動受限
體能快速下降
無法完成比賽
近期表現異常且有來源支持
```

## 搜尋限制

```text
不得把多年以前的舊傷直接當成本場風險
超過180天的資訊，必須有最近90天來源證實仍在影響
不得只因跨國比賽自行推測旅行或時差疲勞
不得使用球迷傳聞作為明確風險
每項 fact 必須由來源直接支持
推論只能寫在 relevance
所有可見內容使用繁體中文
日期統一 YYYY-MM-DD
最多保留5項最有用資訊
```

---

# 八、同一熱門方只搜尋一次

同一輪掃描若同一位熱門方出現在兩場比賽：

```text
第一次
→ 呼叫 Gemini Search

第二次
→ 共用同一位球員的搜尋結果
→ 不再呼叫 API
```

每場仍會保留自己的：

```text
項次
對手
比賽時間
聯賽
評級
```

`external_risk.json` 會記錄：

```text
reused_player_result: true
```

---

# 九、外部風險圖示

## `risk_found`

```text
紅色 !!
```

代表：

```text
找到具體、近期、帶日期且有 Google Search 來源的明確不利資訊
```

## `clear`

```text
無圖示
```

代表：

```text
Google Search 已完成
且沒有找到與本場直接相關的近期異常
```

沒有 Google Search 來源時，不得判定 `clear`。

## `manual_review`

```text
灰藍色 i
```

代表：

```text
找到近期資訊
但影響程度不確定
完整交給使用者自行判讀
```

即使 Gemini 回覆格式不完整，只要已取得文字或來源，資訊不得被隱藏。

## `search_incomplete`

```text
灰色 ↻
```

只代表：

```text
HTTP 429
網路逾時
Gemini 暫時未完成回覆
```

不代表球員有風險，也不代表安全。下次按「分析風險」會重試。

## `system_error`

```text
球員旁不顯示圖示
頁首顯示系統錯誤
```

代表：

```text
Gemini API Key 錯誤
Worker Token 錯誤
HTTP 401／403
權限設定問題
```

---

# 十、快取規則

成功狀態：

```text
risk_found
clear
manual_review
```

快取：

```text
6 小時
```

快取成立條件：

```text
match_key 相同
熱門方相同
評級相同
risk_pipeline_version = gemini-search-v1
checked_at 未超過6小時
```

失敗狀態：

```text
search_incomplete
system_error
```

快取：

```text
0 小時
```

---

# 十一、`external_risk.json` 主要欄位

```text
match_key
item
date_time_taipei
league
home
away
hot_player
rating
status
severity
confidence
summary
impact
findings
raw_search_text
notes
sources
web_search_queries
search_completed
failure_type
http_status
cache_hours
cache_until
checked_at
model
requested_model
search_mode
risk_pipeline_version
request_bytes
usage
```

## `findings` 範例

```json
{
  "date": "2026-08-01",
  "category": "medical_timeout",
  "title": "上一場接受醫療暫停",
  "fact": "球員在上一場第二盤接受醫療暫停。",
  "relevance": "距離本場時間短，需確認恢復情況。",
  "direction": "negative"
}
```

---

# 十二、側邊欄問答分流

## JavaScript 直接回答

例如：

```text
目前有幾場B級
A／B／C各幾場
項次24評級多少
EV最高是哪幾場
哪些場評級勝率超過65%
```

特性：

```text
不呼叫 Gemini
零 API 用量
直接依 ratio_analysis.json 回答
```

## Gemini 2.5 Flash 深入解釋

例如：

```text
為什麼項次24只有C級
比較項次15與項次24
D值與五項方向如何共振
Main Tour權重為什麼較高
```

只傳問題需要的精簡資料，不傳整份巢狀 JSON。

## 側邊欄外部消息

例如：

```text
項次24熱門方有沒有傷病消息
```

會直接使用與「分析風險」相同的 Gemini Google Search 流程。

---

# 十三、Cloudflare Worker

Worker 負責：

```text
R2 JSON讀寫
365Scores代理
TennisRatio代理
Gemini 2.5 Flash深入追問
Gemini 2.5 Flash＋Google Search風險查證
隱藏 GEMINI_API_KEY
CORS與Worker Token驗證
```

## 必要設定

```text
GEMINI_API_KEY  Secret
UPLOAD_TOKEN    Secret
JSON_BUCKET     R2 Binding
```

不再需要：

```text
GROQ_API_KEY
TAVILY_API_KEY
```

## `/health`

應看到：

```json
{
  "ai_provider": ["Gemini"],
  "gemini_risk_model": "gemini-2.5-flash",
  "gemini_chat_model": "gemini-2.5-flash",
  "gemini_google_search": true
}
```

---

# 十四、部署

## GitHub 覆蓋

```text
index.html
styles.css
app.js
README.md
modules/ai-services.js
```

## GitHub 刪除

```text
modules/groq-client.js
modules/gemini-client.js
```

## Cloudflare Worker 覆蓋

```text
Cloudflare/cloudflare-worker.js
```

部署順序：

```text
1. Cloudflare Worker 覆蓋並 Deploy
2. GitHub 覆蓋5個檔案
3. 刪除2個舊AI client
4. 等待 GitHub Pages 更新
5. Ctrl + F5
6. 按「分析風險」
```

---

# 十五、版本

```text
TennisRatio Gemini Search v1
風險模型：gemini-2.5-flash
搜尋工具：Google Search Grounding
風險快取：6小時
A／B勝率門檻：65%
```

## 23. Gemini 共用 Secret、網路問答與全域用量面板

左側問答與上方「分析風險」現在都經由 Cloudflare Worker 呼叫 `gemini-2.5-flash`，並共用 Worker 內的 `GEMINI_API_KEY` Secret。GitHub Pages 不再要求使用者在瀏覽器重新輸入 Gemini API Key。

左側問答可使用 `google_search`，不受 A／B、65% 或外部風險掃描條件限制；系統內的評級數量、EV 排名與單一項次固定資料仍優先由 JavaScript 直接回答，因此不消耗 Gemini。

頁首新增常駐 Gemini 用量面板，無須展開 AI 側欄即可看到：

- 本次問答或風險掃描 Token
- 本配額日 API 請求數
- 問答／風險請求分項
- 本配額日累計 Token
- Google Search RPD 本頁估算剩餘量
- 下一次美國太平洋時間午夜重置所對應的台灣時間與即時倒數

Token 來自 Gemini 回應的 `usageMetadata`。Google 並未在一般 `generateContent` 回應中提供整個專案的精確剩餘 RPD，因此頁面顯示的是本瀏覽器對本頁成功呼叫的本機估算；其他裝置、Google AI Studio 或其他程式使用同一專案的量不會自動計入。

### 部署

GitHub 覆蓋：

- `index.html`
- `styles.css`
- `app.js`
- `README.md`
- `modules/ai-services.js`

Cloudflare Worker 必須同步覆蓋 `Cloudflare/cloudflare-worker.js` 並重新 Deploy，因為左側問答現在也透過 Worker 且啟用 Google Search。Worker 需保留：

- `GEMINI_API_KEY` Secret
- `UPLOAD_TOKEN` Secret
- `JSON_BUCKET` R2 binding


## Gemini 用量面板 Hotfix1

主畫面只保留模型名稱、Google Search RPD 本頁估算、台灣重置時間與「小時／分」倒數。右上角紅色 `?` 可展開本次問答或風險掃描、今日呼叫次數及累計 Token。此版不需要修改 Cloudflare Worker。


## 23. Gemini 安全排程與 Telegram 完成通知

### Gemini 風險掃描

- 同一時間只允許 1 個 Gemini 請求；左側問答與風險掃描共用同一條佇列。
- 每位新球員完成後安全冷卻 30～35 秒。
- 每位球員最多嘗試 2 次。
- 429／503／逾時會依情境等待後重試一次；第二次仍失敗即停止整批，已完成結果保留在 R2。
- RPM、TPM、模型 RPD、Google Search RPD、503、權限、地區、模型、413、逾時會顯示不同診斷，不再統稱「額度滿」。
- 成功結果快取 6 小時；同一熱門方重複出現時共用結果。

### Telegram

三個按鈕完成後都會通知 Telegram chat ID `1880226268`：

- 重新抓取＋完整分析
- 只重跑目前清單
- 分析風險

在 Cloudflare Worker 建立 Secret：

```text
TELEGRAM_BOT_TOKEN
```

API Token 不可寫入 GitHub 或 `app.js`。Bot 必須先由該 Telegram 帳號開啟對話並按 `/start`。

### 安全排程補充

- 風險掃描期間，左側 Gemini 問答會等待整批掃描結束，不會插入 30～35 秒安全冷卻區間。
- 同一頁內所有 Gemini 請求使用單一 JavaScript 佇列；支援 Web Locks 的瀏覽器還會協調同源分頁，避免兩個 TennisRatio 分頁同時送出 Gemini 請求。
- 只有真正呼叫 Gemini 的新球員才需要冷卻；R2 快取或同球員共用結果不會空等 30 秒。
- 停止卡片會列出目前球員、已保存數、未完成數、HTTP、錯誤類型、Quota metric／ID、建議等待與重試次數。

### Telegram Secret

Cloudflare Worker 的 Telegram Token 留在下列 Secret：

```text
TELEGRAM_BOT_TOKEN
```

固定接收 Chat ID：

```text
1880226268
```

Telegram 通知失敗不會回滾已完成分析或刪除 R2 結果；主畫面會明確顯示 Telegram 未送出與錯誤原因。
