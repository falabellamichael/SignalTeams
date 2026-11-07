import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";
const errors = [], failed = [];
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("requestfailed", (r) => failed.push(r.url()));
await page.goto("http://127.0.0.1:8075", { waitUntil: "networkidle" });
await page.click('button:has-text("crew account")');
await page.fill('input:not([type])', "mike");
await page.locator('input[type="password"]').first().fill("password");
await page.click('button:has-text("Sign in"), button:has-text("sign in")');
await page.waitForSelector(".rail", { timeout: 10000 });
await page.waitForTimeout(900);
for (const ic of await page.$$(".rail-ico")) {
  const t = await ic.getAttribute("title");
  if (t && !/Home|Create/.test(t)) { await ic.click(); break; }
}
await page.waitForTimeout(1300);
const names = () => page.locator(".side-body .nav-item .txt").allTextContents();
const before = await names();
console.log("before:", before.slice(0, 4));
// hover the 2nd channel → click ↑
const second = page.locator(".side-body .nav-item").nth(1);
await second.hover();
await second.locator('.ch-gear[title="Move up"]').click();
await page.waitForTimeout(1200);
const after = await names();
console.log("after ↑:", after.slice(0, 4));
console.log("moved:", before[1] === after[0] && before[0] === after[1]);
// move it back
const first = page.locator(".side-body .nav-item").nth(0);
await first.hover();
await first.locator('.ch-gear[title="Move down"]').click();
await page.waitForTimeout(1200);
console.log("restored:", (await names()).slice(0, 4));
console.log("CONSOLE:", errors.length ? errors.slice(0, 3) : "clean");
console.log("FAILED:", failed.length ? failed.slice(0, 3) : "none");
await browser.close();
