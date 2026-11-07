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
await page.waitForTimeout(1500);

// open the group DM (Nova, Juno group has the agents)
await page.locator('.nav-item:has-text("Nova"), .nav-item:has-text("Juno"), .nav-item:has-text("midnight")').first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: "qa-grp1.png" });

// open the add-to-group modal via the ＋ header button
const addBtn = page.locator('.gt-btn[title*="Add friends"]');
console.log("add buttons:", await addBtn.count());
if (await addBtn.count()) {
  await addBtn.first().click();
  await page.waitForTimeout(800);
}
const agentSection = await page.locator("text=/invite an agent/i").count();
console.log("agent section:", agentSection);
const agentRows = await page.locator(".pack-agent").count();
console.log("agent rows:", agentRows);
await page.screenshot({ path: "qa-grp2.png" });
// click an agent row to add it via UI
const agents = page.locator(".pack-agent").filter({ hasText: /Chef|Lore|Sous|Agent/i });
if (await agents.count()) {
  await agents.first().click();
  await page.waitForTimeout(1200);
  const memLine = await page.locator("text=/added .* to the group/i").count();
  console.log("announcement:", memLine);
  await page.screenshot({ path: "qa-grp3.png" });
}

console.log("CONSOLE:", errors.length ? errors.slice(0, 5) : "clean");
console.log("FAILED:", failed.length ? failed.slice(0, 5) : "none");
await browser.close();
