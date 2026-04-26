// Playwright로 검증 페이지 확인
// 사용법: node pages/gentle-monster/scripts/verify_page.mjs <URL>
// 기본 URL: http://localhost:5173/pages/gentle-monster/

import { chromium } from "playwright";

const target = process.argv[2] ?? "http://localhost:5173/pages/gentle-monster/";

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const consoleMsgs = [];
page.on("console", (msg) => {
  consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
});

const failedRequests = [];
page.on("requestfailed", (req) => {
  failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
});

const responses = [];
page.on("response", (res) => {
  responses.push({ url: res.url(), status: res.status() });
});

console.log(`→ navigating to ${target}`);
const navResp = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
console.log(`response: ${navResp?.status()} ${navResp?.statusText()}`);
console.log(`final URL: ${page.url()}`);
console.log(`title: ${await page.title()}`);

// Wait briefly to let async fetches complete
await page.waitForTimeout(3000);

const summary = await page.locator("#summary").textContent().catch(() => "(no #summary found)");
const rowCount = await page.locator("table tbody tr").count().catch(() => 0);
const imgCount = await page.locator("table img").count().catch(() => 0);
const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 500);

console.log(`\n=== page state ===`);
console.log(`summary: ${summary}`);
console.log(`rows: ${rowCount}`);
console.log(`<img> elements: ${imgCount}`);
if (rowCount === 0) {
  console.log(`\nbody text (first 500 chars):\n${bodyText}`);
}

console.log(`\n=== console messages (${consoleMsgs.length}) ===`);
for (const m of consoleMsgs.slice(0, 20)) console.log(m);

console.log(`\n=== failed requests (${failedRequests.length}) ===`);
for (const r of failedRequests.slice(0, 20)) console.log(r);

const non2xx = responses.filter((r) => r.status >= 400);
console.log(`\n=== non-2xx responses (${non2xx.length}) ===`);
for (const r of non2xx.slice(0, 20)) console.log(`  ${r.status}  ${r.url}`);

const screenshot = new URL("verify_page.png", import.meta.url).pathname;
await page.screenshot({ path: screenshot, fullPage: false });
console.log(`\nscreenshot → ${screenshot}`);

await browser.close();
