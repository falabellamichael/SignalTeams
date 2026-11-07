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
const icons = await page.$$(".rail-ico");
for (const ic of icons) {
  const t = await ic.getAttribute("title");
  if (t && !/Home|Create/.test(t)) { await ic.click(); break; }
}
await page.waitForTimeout(1100);
await page.click('.nav-item:has-text("general")');
await page.waitForTimeout(900);
await page.click('textarea');
await page.type('textarea', '/');
await page.waitForTimeout(600);
console.log('menu rows on /:', await page.locator('.mopt').count());
console.log('items:', (await page.locator('.mopt').allTextContents()).slice(0, 9));
await page.type('textarea', 'su');
await page.waitForTimeout(500);
console.log('rows on /su:', await page.locator('.mopt').count(),
  (await page.locator('.mopt').allTextContents()));
await page.screenshot({ path: 'qa-slash.png' });
await page.keyboard.press('Tab');
await page.waitForTimeout(400);
console.log('draft after tab:', await page.locator('textarea').inputValue());
await page.fill('textarea', 'hey @no');
await page.waitForTimeout(500);
console.log('@ rows:', await page.locator('.mopt').count());
console.log('CONSOLE:', errors.length ? errors.slice(0, 4) : 'clean');
console.log('FAILED:', failed.length ? failed.slice(0, 4) : 'none');
await browser.close();
