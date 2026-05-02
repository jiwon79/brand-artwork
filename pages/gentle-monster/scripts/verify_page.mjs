// Playwright로 리스트 페이지 확인 (모바일 뷰포트)
import { chromium, devices } from "playwright";

const target = process.argv[2] ?? "http://localhost:5173/pages/gentle-monster/";
const screenshotDir = new URL(".", import.meta.url).pathname;

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 14 Pro"] });
const page = await context.newPage();

const errs = [];
page.on("pageerror", (e) => errs.push(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(`[console.error] ${m.text()}`);
});

const failed = [];
page.on("requestfailed", (r) => {
  if (r.failure()?.errorText !== "net::ERR_ABORTED") {
    failed.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`);
  }
});

await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(1500);

const itemCount = await page.locator(".item").count();
const loadingHidden = await page.locator("#loading.hidden").count();
console.log(`items: ${itemCount}`);
console.log(`loading hidden: ${loadingHidden}`);
await page.screenshot({ path: `${screenshotDir}verify_initial.png` });

// 핀치 줌 확인 — scale 변경 후 렌더링이 반영되는지
await page.evaluate(() => {
  const stage = document.getElementById("stage");
  const ev = (type, opts) =>
    stage.dispatchEvent(new PointerEvent(type, { bubbles: true, ...opts }));
  ev("pointerdown", { pointerId: 1, clientX: 150, clientY: 300 });
  ev("pointerdown", { pointerId: 2, clientX: 250, clientY: 300 });
  ev("pointermove", { pointerId: 1, clientX: 50, clientY: 300 });
  ev("pointermove", { pointerId: 2, clientX: 350, clientY: 300 });
  ev("pointerup", { pointerId: 1, clientX: 50, clientY: 300 });
  ev("pointerup", { pointerId: 2, clientX: 350, clientY: 300 });
});
await page.waitForTimeout(500);
const sceneT = await page.locator("#scene").evaluate((el) => getComputedStyle(el).transform);
console.log(`scene transform after pinch: ${sceneT.slice(0, 80)}`);
await page.screenshot({ path: `${screenshotDir}verify_pinch.png` });

// 각도 토글
await page.locator('#angle-toggle button[data-angle="D_45"]').click({ force: true });
await page.waitForTimeout(500);
const dActive = await page.locator('#angle-toggle button[data-angle="D_45"].active').count();
const firstSrc = await page.locator(".item img").first().getAttribute("src");
console.log(`D_45 active: ${dActive > 0}`);
console.log(`first img: ${firstSrc?.split("/").pop()}`);
await page.screenshot({ path: `${screenshotDir}verify_d45.png` });

console.log(`\nerrors (${errs.length}):`);
errs.slice(0, 5).forEach((e) => console.log(e));
console.log(`failed reqs (${failed.length}):`);
failed.slice(0, 5).forEach((f) => console.log(f));

await browser.close();
