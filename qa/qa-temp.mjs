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
await page.waitForTimeout(1000);
await page.click('.nav-item:has-text("Agent Library")');
await page.waitForTimeout(1400);
// temp chip on LoreKeeper's card (temp=1.4)
console.log("temp chips:", await page.locator('.model-chip:has-text("🌡")').count());
// open the agent → about tab chip
await page.click('.acard:has-text("LoreKeeper")');
await page.waitForTimeout(900);
console.log("modal chip:", await page.locator('.modal .model-chip:has-text("🌡")').count());
// owner → edit button opens PublishModal
await page.click('.mfoot button:has-text("Edit"), button:has-text("✏ edit")').catch(() => {});
await page.waitForTimeout(700);
const slider = page.locator('input[type=range]');
console.log("slider:", await slider.count(), "| val:", await slider.inputValue().catch(() => "?"));
await page.screenshot({ path: "qa-temp.png", clip: { x: 250, y: 60, width: 700, height: 640 } });
console.log("CONSOLE:", errors.length ? errors.slice(0, 3) : "clean");
console.log("FAILED:", failed.length ? failed.slice(0, 3) : "none");
await browser.close();
