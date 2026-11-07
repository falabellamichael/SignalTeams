import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";

const errs = [], fails = [];
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("requestfailed", (r) => fails.push(r.url() + " " + r.failure()?.errorText));

await page.goto("http://127.0.0.1:8075", { waitUntil: "networkidle" });
await page.waitForSelector('button:has-text("crew account")', { timeout: 8000 });
await page.click('button:has-text("crew account")');
await page.waitForSelector('input:not([type])', { timeout: 5000 });
await page.fill('input:not([type])', "mike");
await page.locator('input[type="password"]').first().fill("password");
await page.click('button:has-text("Sign in"), button:has-text("sign in")');
await page.waitForSelector(".rail", { timeout: 10000 });
await page.waitForTimeout(1000);

// Library -> 💬 on an agent card
await page.click('.nav-item:has-text("Library"), .nav-item:has-text("Agents")').catch(() => {});
await page.waitForTimeout(1200);
const dmBtns = await page.locator('.foot button[title*="DM this agent"]').count();
console.log("dm buttons on cards:", dmBtns);
await page.click('.foot button[title*="DM this agent"]');
await page.waitForTimeout(1500);

// DM should be open — check header + sidebar row
const header = await page.locator('.chat .ch-title, .topbar .name, .chat-head').first().textContent().catch(() => null);
const dmRow = await page.$$eval('.nav-item .txt', (els) => els.map((e) => e.textContent.trim()).filter((t) => t.startsWith("✦")));
const composer = await page.locator(".composer textarea, textarea").last().getAttribute("placeholder").catch(() => null);
console.log("header:", JSON.stringify(header), "| ✦ dm rows:", JSON.stringify(dmRow), "| composer:", JSON.stringify(composer));

// send -> typing -> reply
await page.fill(".composer textarea, textarea", "tell me a lore tidbit");
await page.keyboard.press("Enter");
await page.waitForTimeout(2000);
let typing = await page.locator(".typing, .typers").textContent().catch(() => "");
console.log("typing indicator:", JSON.stringify(typing));
let reply = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(4000);
  const n = await page.locator('.msg .author, .msg .name, .msg').count();
  const txt = await page.locator(".msgs").textContent();
  if (/lorekeeper/i.test(txt)) { reply = "agent replied"; break; }
}
console.log("reply:", reply);

await page.screenshot({ path: "qa-agentdm.png" });
console.log("CONSOLE:", errs.length ? errs.slice(0, 4) : "clean");
console.log("FAILED:", fails.length ? fails.slice(0, 4) : "none");
await b.close();
