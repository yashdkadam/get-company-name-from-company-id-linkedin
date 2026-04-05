import { Actor } from "apify";
import { PlaywrightCrawler, log } from "crawlee";

function buildLinkedInUrl({ companyId, geoId, fTPR, keywords, location }) {
  const params = new URLSearchParams();

  params.set("f_F", "it,eng");
  if (fTPR) params.set("f_TPR", fTPR);
  if (geoId) params.set("geoId", String(geoId));
  if (keywords !== undefined) params.set("keywords", keywords);
  if (location !== undefined) params.set("location", location);
  params.set("f_C", String(companyId));
  params.set("position", "1");
  params.set("pageNum", "0");

  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

function normalizeCompanyName(text) {
  if (!text) return null;

  let value = String(text)
    .replace(/\s+/g, " ")
    .replace("| LinkedIn", "")
    .trim();

  // Common LinkedIn title patterns:
  // "Google Jobs, Employment | LinkedIn"
  // "Google | LinkedIn"
  // "Google jobs"
  value = value
    .replace(/\bJobs?,?\s*Employment\b/i, "")
    .replace(/\bJobs?\b/i, "")
    .replace(/\s*-\s*LinkedIn$/i, "")
    .replace(/\s*\|\s*LinkedIn$/i, "")
    .trim();

  return value || null;
}

async function extractCompanyName(page) {
  const candidates = [];

  // Try meta tags first
  const ogTitle = await page
    .locator('meta[property="og:title"]')
    .getAttribute("content")
    .catch(() => null);
  const metaTitle = await page
    .locator('meta[name="title"]')
    .getAttribute("content")
    .catch(() => null);
  const pageTitle = await page.title().catch(() => null);

  if (ogTitle) candidates.push(ogTitle);
  if (metaTitle) candidates.push(metaTitle);
  if (pageTitle) candidates.push(pageTitle);

  // Try visible heading
  const h1Text = await page
    .locator("h1")
    .first()
    .innerText()
    .catch(() => null);
  if (h1Text) candidates.push(h1Text);

  // Try a few generic text locations
  const headingText = await page
    .locator("main h2, main h1, header h1, header h2")
    .first()
    .innerText()
    .catch(() => null);
  if (headingText) candidates.push(headingText);

  for (const candidate of candidates) {
    const normalized = normalizeCompanyName(candidate);
    if (normalized) return normalized;
  }

  return null;
}

async function isBlockedPage(page) {
  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  const lower = bodyText.toLowerCase();

  return (
    lower.includes("security verification") ||
    lower.includes("unusual activity") ||
    lower.includes("sign in") ||
    lower.includes("captcha") ||
    lower.includes("verify") ||
    lower.includes("access denied")
  );
}

await Actor.main(async () => {
  const input = (await Actor.getInput()) || {};

  const startCompanyId = Number(input.startCompanyId ?? 1);
  const endCompanyId = Number(input.endCompanyId ?? 100);
  const geoId = Number(input.geoId ?? 102713980);
  const fTPR = String(input.fTPR ?? "r604800");
  const keywords = String(input.keywords ?? "");
  const location = String(input.location ?? "India");
  const maxConcurrency = Number(input.maxConcurrency ?? 1);
  const requestTimeoutSecs = Number(input.requestTimeoutSecs ?? 60);

  if (!Number.isInteger(startCompanyId) || !Number.isInteger(endCompanyId)) {
    throw new Error("startCompanyId and endCompanyId must be integers.");
  }
  if (startCompanyId > endCompanyId) {
    throw new Error(
      "startCompanyId must be less than or equal to endCompanyId.",
    );
  }

  const requests = [];
  for (let companyId = startCompanyId; companyId <= endCompanyId; companyId++) {
    const url = buildLinkedInUrl({
      companyId,
      geoId,
      fTPR,
      keywords,
      location,
    });

    requests.push({
      url,
      uniqueKey: String(companyId),
      userData: {
        companyId,
      },
    });
  }

  log.info(`Prepared ${requests.length} LinkedIn URLs.`);

  const crawler = new PlaywrightCrawler({
    maxConcurrency,
    requestHandlerTimeoutSecs: requestTimeoutSecs,
    useSessionPool: true,
    persistCookiesPerSession: true,
    navigationTimeoutSecs: requestTimeoutSecs,
    requestHandler: async ({ page, request }) => {
      const companyId = request.userData.companyId;

      try {
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(1500);

        const blocked = await isBlockedPage(page);
        if (blocked) {
          await Actor.pushData({
            companyId,
            url: request.url,
            companyName: null,
            status: "blocked_or_login_wall",
            scrapedAt: new Date().toISOString(),
          });
          log.warning(`Blocked or login wall for companyId=${companyId}`);
          return;
        }

        const companyName = await extractCompanyName(page);

        await Actor.pushData({
          companyId,
          url: request.url,
          companyName,
          status: companyName ? "ok" : "not_found",
          scrapedAt: new Date().toISOString(),
        });

        log.info(`companyId=${companyId} => ${companyName ?? "not found"}`);
      } catch (err) {
        await Actor.pushData({
          companyId,
          url: request.url,
          companyName: null,
          status: "error",
          errorMessage: err?.message || String(err),
          scrapedAt: new Date().toISOString(),
        });
        log.exception(err, `Failed for companyId=${companyId}`);
      }
    },
    preNavigationHooks: [
      async ({ page }) => {
        await page.setExtraHTTPHeaders({
          "accept-language": "en-US,en;q=0.9",
        });
      },
    ],
  });

  await crawler.run(requests);

  log.info("Done.");
});
