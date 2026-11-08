import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 850 },
    permissions: ['microphone', 'camera']
  });

  const consoleErrors = [];

  // Log in as mike
  const r = await ctx.request.post("http://127.0.0.1:8075/api/login", {
    data: { username: "mike", password: "password" }
  });
  const { token } = await r.json();

  await ctx.addInitScript((t) => localStorage.setItem("signalteams.token", t), token);
  const p = await ctx.newPage();

  p.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
      console.error("Browser Console Error:", msg.text());
    }
  });

  await p.goto("http://127.0.0.1:8075", { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".rail", { timeout: 15000 });
  await p.waitForTimeout(1000);

  // 1. Select a server and channel to check Channel Greeting
  console.log("Navigating to server channel...");
  const srvIcos = await p.$$(".rail-ico");
  for (const ic of srvIcos) {
    const t = await ic.getAttribute("title");
    if (t && !/Home|Create/.test(t)) {
      await ic.click();
      break;
    }
  }
  await p.waitForTimeout(1200);

  // Click on a channel (e.g. show-and-tell or announcements or general)
  const chan = await p.$('.nav-item:has-text("show-and-tell"), .nav-item:has-text("announcements"), .nav-item:has(.ch-hash:has-text("#"))');
  if (chan) {
    await chan.click();
    await p.waitForTimeout(1200);

    // Scroll chat to top to see greeting card
    await p.evaluate(() => {
      const el = document.querySelector('.msgs');
      if (el) el.scrollTop = 0;
    });
    await p.waitForTimeout(600);

    // Verify channel greeting exists
    const cg = await p.$('.channel-greeting');
    console.log("Found Channel Greeting Card:", !!cg);

    // Capture screenshot of channel greeting
    await p.screenshot({ path: "qa/qa-channel-greeting.png" });
    console.log("Saved qa/qa-channel-greeting.png");

    // Click "👋 Wave hello" button
    const waveBtn = await p.$('.channel-greeting .wave-btn');
    if (waveBtn) {
      console.log("Clicking Wave button...");
      await waveBtn.click();
      await p.waitForTimeout(1200);
    }
  }

  // 2. Navigate to Home -> Direct Messages to check DM Greeting
  console.log("Navigating to DMs...");
  const homeIco = await p.$('.rail-ico[title="Home"], .rail-ico:first-child');
  if (homeIco) {
    await homeIco.click();
    await p.waitForTimeout(1200);

    const dmItem = await p.$('.side-body .nav-item:has(.avatar)');
    if (dmItem) {
      await dmItem.click();
      await p.waitForTimeout(1200);

      // Scroll to top
      await p.evaluate(() => {
        const el = document.querySelector('.msgs');
        if (el) el.scrollTop = 0;
      });
      await p.waitForTimeout(600);

      await p.screenshot({ path: "qa/qa-dm-greeting.png" });
      console.log("Saved qa/qa-dm-greeting.png");
    }
  }

  await browser.close();
  console.log("Console errors:", consoleErrors.length);
  console.log("QA Greeting complete!");
}

run().catch((err) => {
  console.error("QA Greeting failed:", err);
  process.exit(1);
});
