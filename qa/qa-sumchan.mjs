import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";

const errs = [], fails = [];
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("requestfailed", (r) => fails.push(r.url() + " " + r.failure()?.errorText));

await page.goto("http://127.0.0.1:8075", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.setItem("signalteams.token",
  JSON.parse(localStorage.getItem("signalteams.token") || "null") || ""));
// fresh login as mike
await page.goto("http://127.0.0.1:8075", { waitUntil: "networkidle" });
await page.click('button:has-text("crew account")').catch(() => {});
await page.waitForTimeout(300);
await page.fill('input[type="text"], input:not([type])', "mike");
const pw = page.locator('input[type="password"]').first();
await pw.fill("password");
await page.click('button:has-text("Sign in"), button:has-text("sign in")');
await page.waitForSelector(".msg .text, .welcome-card, .chat", { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1200);

// open the first server via its rail icon, then #general
const icons = await page.$$(".rail-ico");
for (const ic of icons) {
  const t = await ic.getAttribute("title");
  if (t && !/Home|Create/.test(t)) { await ic.click(); break; }
}
await page.waitForTimeout(1200);
await page.click('.nav-item:has-text("general")').catch(() => {});
await page.waitForTimeout(800);

// send a message containing #announcements (or another chan) to test chip
const chans = await page.$$eval(".nav-item", (els) => els.map((e) => e.textContent.trim()));
console.log("channels:", JSON.stringify(chans));
const other = chans.find((c) => /#/.test(c) && !/general/i.test(c) && !/🔒/.test(c));
const otherName = (other || "").match(/#\s*([a-z0-9_-]+)/i)?.[1]?.toLowerCase() || "";
console.log("target chan:", otherName);

const box = page.locator(".composer textarea, textarea").last();
await box.fill(`moving this convo to #${otherName} — see you there`);
await page.keyboard.press("Enter");
await page.waitForTimeout(700);

const chip = page.locator(".md-mention.ch").last();
const chipText = await chip.textContent().catch(() => null);
const chipColor = await chip.evaluate((el) => getComputedStyle(el).color).catch(() => null);
console.log("chip:", JSON.stringify(chipText), "color:", chipColor);

// click the chip -> should navigate to that channel
await chip.click().catch(() => {});
await page.waitForTimeout(900);
const composerPh = await page.locator(".composer textarea, textarea").last().getAttribute("placeholder");
console.log("after-click composer:", JSON.stringify(composerPh));

// now /summarize via composer (queues; response arrives via WS — just verify no error + queued toast/none)
await box.fill("/summarize 8");
await page.keyboard.press("Enter");
await page.waitForTimeout(1500);
const errChip = await page.locator(".slow-chip.err").textContent().catch(() => null);
console.log("composer error chip:", JSON.stringify(errChip));

// wait for scribe reply (LLM or fallback)
let scribe = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(3000);
  scribe = await page.$$eval(".msg .avatar-name, .msg .author, .msg .name",
    (els) => els.slice(-4).map((e) => e.textContent));
  const has = await page.locator('.msg:has-text("recap — last")').count();
  if (has) { console.log("scribe posted at iter", i); break; }
}
const scribeMsg = await page.locator('.msg:has-text("recap — last")').last().textContent().catch(() => null);
console.log("scribe msg:", JSON.stringify((scribeMsg || "").slice(0, 130)));

await page.screenshot({ path: "qa-sumchan.png" });
console.log("CONSOLE:", errs.length ? errs.slice(0, 4) : "clean");
console.log("FAILED:", fails.length ? fails.slice(0, 4) : "none");
await b.close();
