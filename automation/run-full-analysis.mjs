import { chromium } from "playwright";

const password = String(process.env.FULL_ANALYSIS_PASSWORD || "").trim();
const pageUrl = String(process.env.TENNIS_PAGE_URL || "").trim();
const workerBaseUrl = String(process.env.TENNIS_WORKER_URL || "").trim().replace(/\/+$/, "");

if (!password) throw new Error("GitHub Secret FULL_ANALYSIS_PASSWORD 尚未設定。");
if (!pageUrl) throw new Error("TENNIS_PAGE_URL 尚未設定。");
if (!workerBaseUrl) throw new Error("TENNIS_WORKER_URL 尚未設定。");

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "zh-TW",
  timezoneId: "Asia/Taipei"
});
const page = await context.newPage();

page.on("console", msg => {
  const type = msg.type();
  if (["error", "warning"].includes(type)) {
    console.log(`[browser ${type}] ${msg.text()}`);
  }
});
page.on("pageerror", error => {
  console.log(`[browser pageerror] ${error?.message || String(error)}`);
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function text(selector) {
  return String(await page.locator(selector).textContent().catch(() => "") || "").trim();
}

async function proxyArcadia(route) {
  const original = new URL(route.request().url());
  let endpoint = null;

  if (original.pathname.endsWith("/sports/33/matchups")) {
    endpoint = `${workerBaseUrl}/source/arcadia/matchups`;
  } else if (original.pathname.endsWith("/sports/33/markets/straight")) {
    endpoint = `${workerBaseUrl}/source/arcadia/markets`;
  }

  if (!endpoint) {
    await route.continue();
    return;
  }

  console.log(`[Arcadia proxy] ${original.pathname} -> ${endpoint}`);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json,text/plain,*/*" },
    cache: "no-store"
  });
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "application/json; charset=utf-8";

  await route.fulfill({
    status: response.status,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    },
    body
  });
}

try {
  // app.js 不改：只有 GitHub 自動執行時，把 Arcadia 兩支 GET 改走既有 Cloudflare Worker。
  await page.route("https://guest.api.arcadia.pinnacle.com/**", proxyArcadia);

  console.log(`Open: ${pageUrl}`);
  await page.goto(pageUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });

  const fullButton = page.locator('.run-button[data-mode="full"]');
  await fullButton.waitFor({ state: "visible", timeout: 60_000 });

  console.log("Click: 重新抓取＋完整分析");
  await fullButton.click();

  const passwordInput = page.locator("#full-analysis-password");
  await passwordInput.waitFor({ state: "visible", timeout: 30_000 });
  await passwordInput.fill(password);
  await page.locator("#full-analysis-auth-submit").click();

  console.log("Password submitted. Waiting for full pipeline...");

  const deadline = Date.now() + 60 * 60 * 1000;
  let lastStatus = "";

  while (Date.now() < deadline) {
    const status = await text("#status-text");
    const toastTitle = await text("#analysis-toast-title");
    const toastBody = await text("#analysis-toast-body");
    const authStatus = await text("#full-analysis-auth-status");

    if (status && status !== lastStatus) {
      console.log(`[status] ${status}`);
      lastStatus = status;
    }

    const failureText = `${status}\n${toastTitle}\n${toastBody}\n${authStatus}`;
    if (
      /啟動密碼不正確|完整分析執行失敗|按鈕執行失敗|TennisRatio 分析失敗|JavaScript 執行錯誤|未處理的執行錯誤/.test(failureText)
    ) {
      throw new Error(failureText.replace(/\n+/g, " | "));
    }

    if (
      /TennisRatio 全部分析完成|分析完成，但外部風險有待確認|分析已完成｜Telegram 未送出/.test(toastTitle)
    ) {
      console.log(`[complete] ${toastTitle}`);
      if (toastBody) console.log(`[detail] ${toastBody}`);
      break;
    }

    await sleep(5000);
  }

  const finalTitle = await text("#analysis-toast-title");
  if (!/TennisRatio 全部分析完成|分析完成，但外部風險有待確認|分析已完成｜Telegram 未送出/.test(finalTitle)) {
    throw new Error("等待完整分析完成逾時（60 分鐘）。");
  }

  const analysis = await page.evaluate(() => {
    try {
      const value = window.TennisRatioApp?.getAnalysis?.();
      return value ? {
        matches: Array.isArray(value.matches) ? value.matches.length : 0,
        generated_at: value.generated_at || value.generated_at_taiwan || null
      } : null;
    } catch {
      return null;
    }
  });

  console.log("Full analysis finished.", analysis || "");
} catch (error) {
  try {
    await page.screenshot({
      path: "automation/full-analysis-failure.png",
      fullPage: true
    });
  } catch {}
  throw error;
} finally {
  await browser.close();
}
