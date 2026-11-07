import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";

const B = "http://127.0.0.1:8075";
const browser = await chromium.launch({
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--auto-select-desktop-capture-source=Entire screen",
  ],
});
const errors = [], failed = [];

async function loginPage(user) {
  const ctx = await browser.newContext({ permissions: ["microphone", "camera"] });
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
  await page.waitForTimeout(800);
  return page;
}

const mike = await loginPage("mike");
const nova = await loginPage("nova");

// both open #general in Signal HQ (rail icon → server sidebar)
for (const p of [mike, nova]) {
  const icons = await p.$$(".rail-ico");
  for (const ic of icons) {
    const t = await ic.getAttribute("title");
    if (t && !/Home|Create/.test(t)) { await ic.click(); break; }
  }
  await p.waitForTimeout(1100);
  await p.click('.nav-item:has-text("general")');
  await p.waitForTimeout(800);
}
// both join voice via topbar 🎧
for (const p of [mike, nova]) {
  await p.click('.ch-tools button[title="Join voice"]');
  await p.waitForTimeout(1800);
}
console.log("mike voice bar:", await mike.locator(".voice-bar.in").count());
console.log("nova voice bar:", await nova.locator(".voice-bar.in").count());

// mike turns camera on
await mike.locator('.vb-btn:has-text("📹")').first().click();
await mike.waitForTimeout(3500);

// nova should see a remote tile labeled "Mike's camera"
const tiles = await nova.locator(".voice-stage .vs-tile").count();
const names = await nova.locator(".vs-name").allTextContents();
console.log("nova tiles:", tiles, names);
const chipText = await nova.locator(".vb-chip").allTextContents();
console.log("nova chips:", chipText);
// mike's local preview
console.log("mike tiles:", await mike.locator(".vs-tile").count(),
  await mike.locator(".vs-name").allTextContents());
await mike.screenshot({ path: "qa-cam-mike.png" });
await nova.screenshot({ path: "qa-cam-nova.png" });

// real video track flowing on nova's side?
const vid = await nova.evaluate(() => {
  const v = document.querySelector(".voice-stage video");
  return v && v.srcObject ? {
    active: v.srcObject.active,
    tracks: v.srcObject.getTracks().map((t) => t.kind),
    playing: !v.paused,
  } : null;
});
console.log("nova remote video:", JSON.stringify(vid));

// mike stops camera
await mike.locator('.vb-btn:has-text("📹")').first().click();
await mike.waitForTimeout(2500);
console.log("after stop — nova tiles:", await nova.locator(".voice-stage .vs-tile").count(),
  "chips:", await nova.locator(".vb-chip").allTextContents());

console.log("CONSOLE:", errors.length ? errors.slice(0, 5) : "clean");
console.log("FAILED:", failed.length ? failed.slice(0, 5) : "none");
await browser.close();
