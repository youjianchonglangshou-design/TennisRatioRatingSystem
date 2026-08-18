const REPO = "youjianchonglangshou-design/TennisRatioRatingSystem";
const WORKFLOW_FILE = "cloudflare-full-analysis.yml";
const REF = "main";

async function dispatchGitHub(env) {
  if (!env.GITHUB_TOKEN) {
    throw new Error("Cloudflare Secret GITHUB_TOKEN 尚未設定");
  }

  const response = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "TennisRatio-Cloudflare-Scheduler"
      },
      body: JSON.stringify({ ref: REF })
    }
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub dispatch HTTP ${response.status}: ${body}`);
  }

  console.log("GitHub full-analysis workflow dispatched", response.status, body);
  return body;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response(
        "TennisRatio GitHub Scheduler is ready. Cron: TW 00:01 / 06:01 / 12:01 / 18:01",
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(dispatchGitHub(env));
  }
};
