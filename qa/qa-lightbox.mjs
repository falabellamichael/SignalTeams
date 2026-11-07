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
await page.waitForTimeout(1200);
await page.click('.nav-item:has-text("general")');
await page.waitForTimeout(1400);

const img = page.locator(".att-img").last();
console.log("att imgs:", await page.locator(".att-img").count());
await img.click();
await page.waitForTimeout(600);
console.log("lightbox:", await page.locator(".lb").count(),
  "| lb img:", await page.locator(".lb-img").count(),
  "| name:", (await page.locator(".lb-name").textContent() || "").trim());
await page.screenshot({ path: "qa-lightbox.png" });
// ESC closes
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
console.log("after esc:", await page.locator(".lb").count());
// reopen + backdrop click closes
await img.click();
await page.waitForTimeout(400);
await page.mouse.click(30, 500);   // backdrop corner
await page.waitForTimeout(400);
console.log("after backdrop:", await page.locator(".lb").count());
console.log("CONSOLE:", errors.length ? errors.slice(0, 3) : "clean");
console.log("FAILED:", failed.length ? failed.slice(0, 3) : "none");
await browser.close();
