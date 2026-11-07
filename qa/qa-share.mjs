import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";

const errs = [], fails = [];
const b = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--auto-select-desktop-capture-source=Entire screen",
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

// both join voice
await mike.click('.ch-tools button[title="Join voice"]');
await mike.waitForTimeout(1200);
await nova.click('.voice-bar .vb-btn:has-text("join"), .ch-tools button[title="Join voice"]');
await nova.waitForTimeout(2500);

// mike starts sharing
await mike.click('.vb-btn[title="Share screen"]');
await mike.waitForTimeout(2500);

// nova: video tile + 🖥 chip + receiver track
const nStage = await nova.locator(".voice-stage").count();
const nTiles = await nova.$$eval(".vs-tile video", (els) => els.length).catch(() => 0);
const nLabel = await nova.locator(".vs-name").textContent().catch(() => null);
const nChip = await nova.$$eval(".vb-chip", (els) => els.map((e) => e.textContent));
const nVideoLive = await nova.evaluate(() => {
  const v = document.querySelector(".vs-tile video");
  return v && v.srcObject ? { active: v.srcObject.active, tracks: v.srcObject.getTracks().map((t) => t.kind) } : null;
});
console.log("nova stage:", nStage, "tiles:", nTiles, "label:", JSON.stringify(nLabel));
console.log("nova chips:", JSON.stringify(nChip));
console.log("nova video stream:", JSON.stringify(nVideoLive));

// non-participant view — open a third page as juno (sees 🖥 in roster but no video until join)
const juno = await login(await b.newContext(opts), "juno");
await juno.waitForTimeout(1000);
const jBar = await juno.locator(".voice-bar").textContent().catch(() => null);
const jStage = await juno.locator(".voice-stage").count();
console.log("juno bar:", JSON.stringify(jBar), "| juno stage (should be 0):", jStage);

// mike stops sharing
await mike.click('.vb-btn[title="Stop sharing"]');
await nova.waitForTimeout(1500);
const nStageAfter = await nova.locator(".voice-stage").count();
const nChipAfter = await nova.$$eval(".vb-chip", (els) => els.map((e) => e.textContent));
console.log("after stop — nova stage:", nStageAfter, "chips:", JSON.stringify(nChipAfter));

await nova.screenshot({ path: "qa-share.png" });
console.log("CONSOLE:", errs.length ? errs.slice(0, 5) : "clean");
console.log("FAILED:", fails.length ? fails.slice(0, 4) : "none");
await b.close();
