import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";
const B = "http://127.0.0.1:8075";
const errors = [], failed = [];
const browser = await chromium.launch();

async function loginPage(user) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${user}: ${m.text()}`); });
  page.on("requestfailed", (r) => failed.push(`${user}: ${r.url()}`));
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${user}: ${r.status()} ${r.url()}`); });
  await page.goto(B, { waitUntil: "networkidle" });
  await page.waitForSelector('button:has-text("crew account")', { timeout: 8000 });
  await page.click('button:has-text("crew account")');
  await page.waitForSelector('input:not([type])', { timeout: 5000 });
  await page.fill('input:not([type])', user);
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
  return page;
}

// knocktest (denied earlier — still locked) opens the gated channel
const kt = await loginPage("knocktest");
await kt.click('.nav-item:has-text("vip-lounge")');
await kt.waitForTimeout(1200);
const lockBig = await kt.locator('.empty .big:has-text("🔒")').count();
const knockBtn = await kt.locator('button:has-text("knock to join")').count();
console.log("knocker: locked state:", lockBig, "| knock btn:", knockBtn);
await kt.screenshot({ path: "qa-knock1.png" });
if (knockBtn) {
  await kt.locator('button:has-text("knock to join")').click();
  await kt.waitForTimeout(1200);
  console.log("knocker: pending text:", await kt.locator('text=/knock sent/').count());
  await kt.screenshot({ path: "qa-knock2.png" });
}

// mike (insider) sees the knock bar and approves
const mk = await loginPage("mike");
await mk.click('.nav-item:has-text("vip-lounge")');
await mk.waitForTimeout(1500);
const kbar = await mk.locator(".knock-bar").count();
const krow = await mk.locator(".knock-row").allTextContents();
console.log("insider: knock bar:", kbar, krow);
await mk.screenshot({ path: "qa-knock3.png" });
if (kbar) {
  await mk.locator('.kb-y:has-text("let in")').first().click();
  await mk.waitForTimeout(1500);
  console.log("insider: bar after approve:", await mk.locator(".knock-bar").count());
}
// knocker reloads → channel unlocked (re-navigate into the server)
await kt.reload({ waitUntil: "networkidle" });
await kt.waitForSelector(".rail", { timeout: 10000 });
await kt.waitForTimeout(900);
for (const ic of await kt.$$(".rail-ico")) {
  const t = await ic.getAttribute("title");
  if (t && !/Home|Create/.test(t)) { await ic.click(); break; }
}
await kt.waitForTimeout(1100);
await kt.click('.nav-item:has-text("vip-lounge")');
await kt.waitForTimeout(1200);
console.log("knocker: still locked?", await kt.locator('.empty .big:has-text("🔒")').count(),
  "| msgs visible:", await kt.locator(".msg").count());
await kt.screenshot({ path: "qa-knock4.png" });
console.log("CONSOLE:", errors.length ? errors.slice(0, 5) : "clean");
console.log("FAILED:", failed.length ? failed.slice(0, 5) : "none");
await browser.close();
