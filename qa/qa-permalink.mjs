import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";
const B = "http://127.0.0.1:8075";
const errors = [], failed = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
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
await page.click('.nav-item:has-text("general")');
await page.waitForTimeout(900);

// right-click a message → Copy link
await page.locator(".msg").nth(3).click({ button: "right" });
await page.waitForTimeout(600);
const linkItem = await page.locator('.mm-item:has-text("Copy link")').count();
console.log("copy link item:", linkItem);
await page.locator('.mm-item:has-text("Copy link")').click();
await page.waitForTimeout(400);
const clip = await page.evaluate(() => navigator.clipboard.readText());
console.log("clipboard:", clip);

// post it in #starboard and click it
await page.click('.nav-item:has-text("starboard")');
await page.waitForTimeout(900);
await page.fill('textarea', `check this ${clip}`);
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
const link = page.locator('.msgs a[href*="#/s/"]').last();
console.log("permalink rendered:", await link.count());
await link.click();
await page.waitForTimeout(1500);
const header = await page.locator(".chat-head h2, .chat-head .h-title").first().textContent().catch(() => "?");
console.log("after click — view:", header);
await page.screenshot({ path: "qa-permalink.png" });

// cold-load via hash — new page to the same permalink
const page2 = await ctx.newPage();
await page2.goto(B + "/" + clip.slice(clip.indexOf("#")), { waitUntil: "networkidle" });
await page2.waitForSelector(".rail", { timeout: 10000 });
await page2.waitForTimeout(2000);
const h2 = await page2.locator(".chat-head h2, .chat-head .h-title").first().textContent().catch(() => "?");
console.log("cold load view:", h2);
await page2.screenshot({ path: "qa-permalink2.png" });

console.log("CONSOLE:", errors.length ? errors.slice(0, 4) : "clean");
console.log("FAILED:", failed.length ? failed.slice(0, 4) : "none");
await browser.close();
