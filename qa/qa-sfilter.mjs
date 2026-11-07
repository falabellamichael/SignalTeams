import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";

const errs = [], fails = [];
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("requestfailed", (r) => fails.push(r.url() + " " + r.failure()?.errorText));

await page.goto("http://127.0.0.1:8075", { waitUntil: "networkidle" });
await page.click('button:has-text("crew account")').catch(() => {});
await page.waitForTimeout(300);
await page.fill('input[type="text"], input:not([type])', "mike");
await page.locator('input[type="password"]').first().fill("password");
await page.click('button:has-text("Sign in"), button:has-text("sign in")');
await page.waitForSelector(".rail", { timeout: 10000 });
await page.waitForTimeout(1200);

// open first server + #general
const icons = await page.$$(".rail-ico");
for (const ic of icons) {
  const t = await ic.getAttribute("title");
  if (t && !/Home|Create/.test(t)) { await ic.click(); break; }
}
await page.waitForTimeout(1200);
await page.click('.nav-item:has-text("general")');
await page.waitForTimeout(900);

// channel search: open 🔍, type from:nova
await page.click('.ch-tools button[title="Search channel"]');
await page.waitForTimeout(400);
await page.fill('.ch-panel input', "from:nova sfprobe");
await page.waitForTimeout(1200);
const hint = await page.locator('.ch-panel .idehint').first().textContent().catch(() => null);
const hits = await page.$$eval('.ch-panel .ideopt', (els) => els.map((e) => e.textContent.slice(0, 60)));
console.log("ch hint:", JSON.stringify(hint));
console.log("ch hits:", JSON.stringify(hits));

// global search via Ctrl+K
await page.keyboard.press("Control+k");
await page.waitForTimeout(600);
const ghint = await page.locator('.modal .idehint, .modal-card .idehint').first().textContent().catch(() => null);
console.log("g hint:", JSON.stringify(ghint));
await page.fill('.modal input, .modal-card input', "in:starboard");
await page.waitForTimeout(1200);
const ghits = await page.$$eval('.pack-agent', (els) => els.map((e) => e.textContent.slice(0, 70)));
console.log("g hits:", JSON.stringify(ghits));

await page.screenshot({ path: "qa-sfilter.png" });
console.log("CONSOLE:", errs.length ? errs.slice(0, 4) : "clean");
console.log("FAILED:", fails.length ? fails.slice(0, 4) : "none");
await b.close();
