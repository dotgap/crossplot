// Smoke test for the dinosaur demo: load, brush the age timeline, report, screenshot.
// Usage: node smoke.cjs [url] [screenshot.png]
const { chromium } = require("playwright");

const url = process.argv[2] || "http://localhost:4173/";
const out = process.argv[3] || "demo.png";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(url);
  await page.waitForSelector(".crossplot-chart svg");
  await page.waitForFunction(() => /\d/.test(document.querySelector("[data-total]")?.textContent || ""));
  const total = () => page.locator("#sentence").textContent();
  console.log("charts", await page.locator(".crossplot-chart").count(), "total:", await total());

  await page.locator("#age").scrollIntoViewIfNeeded();
  const box = await page.locator("#age .crossplot-overlay").first().boundingBox();
  if (box) {
    const y = box.y + Math.min(60, box.height / 2);
    await page.mouse.move(box.x + box.width * 0.5, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    console.log("after brush:", await total(), "hash:", decodeURIComponent(new URL(page.url()).hash));
  } else {
    console.log("no #age chart overlay found; skipped the brush");
  }

  await page.screenshot({ path: out, fullPage: true });
  console.log("screenshot", out);
  console.log("errors", errors);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
