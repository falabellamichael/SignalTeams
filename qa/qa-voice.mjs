import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";

const errs = [], fails = [];
const b = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

async function login(ctx, user) {
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errs.push(user + ": " + m.text()); });
  page.on("requestfailed", (r) => fails.push(r.url() + " " + r.failure()?.errorText));
  await page.goto("http://127.0.0.1:8075", { waitUntil: "networkidle" });
  await page.waitForSelector('button:has-text("crew account")', { timeout: 8000 });
  await page.click('button:has-text("crew account")');
  await page.waitForSelector('input:not([type])', { timeout: 5000 });
  await page.fill('input[type="text"], input:not([type])', user);
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

// mike joins voice via the topbar 🎧
await mike.click('.ch-tools button[title="Join voice"]');
await mike.waitForTimeout(1500);
const mBar = await mike.locator(".voice-bar").textContent().catch(() => null);
console.log("mike bar:", JSON.stringify(mBar));

// nova should see "1 in voice" bar + join button (roster broadcast)
await nova.waitForTimeout(800);
const nBar = await nova.locator(".voice-bar").textContent().catch(() => null);
console.log("nova bar:", JSON.stringify(nBar));

// nova joins
await nova.click('.voice-bar .vb-btn:has-text("join"), .ch-tools button[title="Join voice"]');
await nova.waitForTimeout(2500);

// both should show 2-member roster
const mChips = await mike.$$eval(".vb-chip", (els) => els.map((e) => e.textContent.trim()));
const nChips = await nova.$$eval(".vb-chip", (els) => els.map((e) => e.textContent.trim()));
console.log("mike chips:", JSON.stringify(mChips));
console.log("nova chips:", JSON.stringify(nChips));

// peer-connection state — the actual WebRTC proof
const conn = await Promise.all([mike, nova].map((p) => p.evaluate(() => {
  const mod = window.__voicePeers;
  return mod ? [...mod.entries()].map(([uid, p]) => ({
    uid, conn: p.pc.connectionState, ice: p.pc.iceConnectionState,
    sig: p.pc.signalingState, hasRemoteAudio: !!p.audio.srcObject,
  })) : null;
})));
console.log("mike peers:", JSON.stringify(conn[0]));
console.log("nova peers:", JSON.stringify(conn[1]));

// nova mutes -> mike sees muted chip
await nova.click('.vb-btn[title="Mute"]').catch(() => {});
await mike.waitForTimeout(1000);
const mMuted = await mike.$$eval(".vb-chip.muted", (els) => els.length);
console.log("muted chips on mike:", mMuted);

// nova leaves -> roster back to 1
await nova.click('.vb-btn[title="Leave voice"], .vb-btn.vb-leave').catch(() => {});
await mike.waitForTimeout(1200);
const mAfter = await mike.$$eval(".vb-chip", (els) => els.length);
const nGone = await nova.locator(".voice-bar").count();
console.log("mike chips after leave:", mAfter, "| nova bars:", nGone);

await mike.screenshot({ path: "qa-voice.png" });
console.log("CONSOLE:", errs.length ? errs.slice(0, 5) : "clean");
console.log("FAILED:", fails.length ? fails.slice(0, 4) : "none");
await b.close();
