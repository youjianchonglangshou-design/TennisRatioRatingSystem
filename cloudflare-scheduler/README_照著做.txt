TennisRatio｜Cloudflare 排程 → GitHub 完整分析
================================================

這版不需要 npm、不需要 Wrangler、不需要 Cloudflare Workflows。

A. GitHub
---------
把整個專案上傳／覆蓋到：
youjianchonglangshou-design/TennisRatioRatingSystem

本版只新增：
1. .github/workflows/cloudflare-full-analysis.yml
2. automation/run-full-analysis.mjs
3. cloudflare-scheduler/worker.js
4. cloudflare-scheduler/README_照著做.txt

接著 GitHub：
Settings → Secrets and variables → Actions → New repository secret

Name：FULL_ANALYSIS_PASSWORD
Value：填你現在按「重新抓取＋完整分析」時輸入的那組密碼

完成後，到 Actions 應該會看到：
Cloudflare Full Analysis

可以先按 Run workflow 測試一次。


B. Cloudflare
-------------
1. Workers & Pages → Create → Worker
2. 名稱可填：tennis-github-scheduler
3. Edit code
4. 把 cloudflare-scheduler/worker.js 全部貼上 → Deploy

5. Worker → Settings → Variables and Secrets
新增 Secret：
Name：GITHUB_TOKEN
Value：你的 GitHub Fine-grained personal access token
權限至少要：這個 repo 的 Actions = Read and write

6. Worker → Settings / Triggers → Cron Triggers
新增：
1 4,10,16,22 * * *

Cloudflare Cron 使用 UTC。
上面的時間換算台灣時間就是：
00:01
06:01
12:01
18:01


運作方式
--------
Cloudflare 到點
→ 呼叫 GitHub workflow_dispatch
→ GitHub Action 啟動 Chromium
→ 打開正式 GitHub Pages
→ 自動按「重新抓取＋完整分析」
→ 自動輸入 FULL_ANALYSIS_PASSWORD
→ 完整跑 Phase 2 / Phase 3 / Phase 4 / 外部風險
→ 原本 R2 與 Telegram 流程照舊

Cloudflare 本身完全不執行 Formula B，也不需要把你的分析引擎搬進 Worker。
