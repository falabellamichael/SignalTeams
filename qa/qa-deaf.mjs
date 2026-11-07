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

await mike.click('.ch-tools button[title="Join voice"]');
await mike.waitForTimeout(1200);
await nova.click('.voice-bar .vb-btn:has-text("join"), .ch-tools button[title="Join voice"]');
await nova.waitForTimeout(2500);

// nova deafens
await nova.click('.vb-btn[title*="Deafen"]');
await nova.waitForTimeout(1200);
const mChips = await mike.$$eval(".vb-chip", (e) => e.map((x) => x.textContent.trim()));
const nAudioMuted = await nova.evaluate(() =>
  [...window.__voicePeers.values()].map((p) => p.audio.muted));
const nMic = await nova.evaluate(() => {
  const st = document.querySelector('.vb-btn[title*="Undeafen"]');
  return !!st;
});
console.log("mike sees chips:", JSON.stringify(mChips));
console.log("nova peer audio.muted:", JSON.stringify(nAudioMuted), "| undeafen btn present:", nMic);

// nova undeafens — remote audio back, still muted mic
await nova.click('.vb-btn[title*="Undeafen"]');
await nova.waitForTimeout(1200);
const mChips2 = await mike.$$eval(".vb-chip", (e) => e.map((x) => x.textContent.trim()));
const nAudio2 = await nova.evaluate(() =>
  [...window.__voicePeers.values()].map((p) => p.audio.muted));
console.log("after undeafen — mike chips:", JSON.stringify(mChips2), "| nova audio:", JSON.stringify(nAudio2));

await mike.screenshot({ path: "qa-deaf.png" });
console.log("CONSOLE:", errs.length ? errs.slice(0, 5) : "clean");
console.log("FAILED:", fails.length ? fails.slice(0, 4) : "none");
await b.close();
