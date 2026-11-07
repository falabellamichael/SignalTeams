import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";

const errs = [], fails = [];
const b = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required"],
});

async function login(ctx, user) {
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errs.push(user + ": " + m.text()); });
  page.on("requestfailed", (r) => fails.push(r.url() + " " + r.failure()?.errorText));
  await page.goto("http://127.0.0.1:8075", { waitUntil: "networkidle" });
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
  await page.click('.nav-item:has-text("general")');
  await page.waitForTimeout(800);
  return page;
}

const opts = { viewport: { width: 1280, height: 720 }, permissions: ["microphone"] };
const mike = await login(await b.newContext(opts), "mike");
const nova = await login(await b.newContext(opts), "nova");
const juno = await login(await b.newContext(opts), "juno");   // observer only

await mike.click('.ch-tools button[title="Join voice"]');
await mike.waitForTimeout(1200);
await nova.click('.voice-bar .vb-btn:has-text("join"), .ch-tools button[title="Join voice"]');
await nova.waitForTimeout(3000);   // peers connect + tones ramp

// speaking rings — fake mic tone should flag each side's remote
for (let i = 0; i < 8; i++) {
  const m = await mike.$$eval(".vb-chip.speaking", (e) => e.length);
  const n = await nova.$$eval(".vb-chip.speaking", (e) => e.length);
  console.log(`iter${i} speaking rings — mike sees: ${m}, nova sees: ${n}`);
  if (m > 0 && n > 0) break;
  await mike.waitForTimeout(700);
}

// sidebar voice rows — all three clients (juno never joined)
const mRows = await mike.$$eval(".ch-voice .ch-vm", (e) => e.map((x) => x.textContent.trim()));
const jRows = await juno.$$eval(".ch-voice .ch-vm", (e) => e.map((x) => x.textContent.trim()));
console.log("sidebar voice rows — mike:", JSON.stringify(mRows), "juno:", JSON.stringify(jRows));

// mute kills the ring (remote side detects silence)
await nova.click('.vb-btn[title="Mute"]');
await mike.waitForTimeout(1600);
const mSpeak2 = await mike.$$eval(".vb-chip.speaking", (e) => e.map((x) => x.textContent.trim()));
console.log("after nova mutes, mike speaking:", JSON.stringify(mSpeak2));

await mike.screenshot({ path: "qa-speak.png" });
console.log("CONSOLE:", errs.length ? errs.slice(0, 5) : "clean");
console.log("FAILED:", fails.length ? fails.slice(0, 4) : "none");
await b.close();
