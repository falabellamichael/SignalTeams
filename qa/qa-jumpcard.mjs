import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";
const B = "http://127.0.0.1:8075";
const errors = [], failed = [];
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("requestfailed", (r) => failed.push(r.url()));
page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
await page.goto(B, { waitUntil: "networkidle" });
await page.waitForSelector('button:has-text("crew account")', { timeout: 8000 });
await page.click('button:has-text("crew account")');
await page.waitForSelector('input:not([type])', { timeout: 5000 });
await page.fill('input:not([type])', "mike");
await page.locator('input[type="password"]').first().fill("password");
await page.click('button:has-text("Sign in"), button:has-text("sign in")');
await page.waitForSelector(".rail", { timeout: 10000 });
await page.waitForTimeout(900);
for (const ic of await page.$$(".rail-ico")) {
  const t = await ic.getAttribute("title");
  if (t && !/Home|Create/.test(t)) { await ic.click(); break; }
}
await page.waitForTimeout(1100);
await page.click('.nav-item:has-text("starboard")');
await page.waitForTimeout(1500);
const cards = await page.locator(".jump-card").count();
const txt = await page.locator(".jump-card .jc-x").allTextContents();
const heads = await page.locator(".jump-card .jc-head").allTextContents();
console.log("jump cards:", cards, "| heads:", heads, "| excerpts:", txt);
await page.screenshot({ path: "qa-jumpcard.png" });
// click it → should land in #general scrolled to msg 37
await page.locator(".jump-card").last().click();
await page.waitForTimeout(1500);
const url = page.url();
const focused = await page.locator("#msg-37, .msg.flash, .msg").count();
console.log("after click url:", url, "| msgs:", focused);
await page.screenshot({ path: "qa-jumpcard2.png" });
console.log("CONSOLE:", errors.length ? errors.slice(0, 4) : "clean");
console.log("FAILED:", failed.length ? failed.slice(0, 4) : "none");
await browser.close();
