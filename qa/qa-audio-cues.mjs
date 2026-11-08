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

  // Track console errors
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

  // 1. Open Settings Modal to verify Audio Controls
  console.log("Opening Settings Modal...");
  const gearBtn = await p.$('.me-btn[title="Settings"]');
  if (gearBtn) {
    await gearBtn.click();
    await p.waitForSelector('.modal', { timeout: 5000 });
    await p.waitForTimeout(600);

    // Verify "Tactile Audio Cues" section exists
    const audioLab = await p.$('div.lab:has-text("Tactile Audio Cues")');
    console.log("Found Tactile Audio Cues label:", !!audioLab);

    // Click "🔊 Test Sound"
    const testSoundBtn = await p.$('button:has-text("Test Sound")');
    if (testSoundBtn) {
      console.log("Clicking Test Sound button...");
      await testSoundBtn.click();
      await p.waitForTimeout(400);
    }

    // Switch profile to Crisp Tactile
    const crispBtn = await p.$('button:has-text("Crisp Tactile")');
    if (crispBtn) {
      console.log("Switching to Crisp Tactile profile...");
      await crispBtn.click();
      await p.waitForTimeout(400);
    }

    // Switch back to Soothing Thock
    const thockBtn = await p.$('button:has-text("Soothing Thock")');
    if (thockBtn) {
      console.log("Switching back to Soothing Thock profile...");
      await thockBtn.click();
      await p.waitForTimeout(400);
    }

    // Capture screenshot of settings audio controls
    await p.screenshot({ path: "qa/qa-audio-settings.png" });
    console.log("Saved qa/qa-audio-settings.png");

    // Close settings modal
    const closeBtn = await p.$('.modal-head button, .m-close, .modal-x');
    if (closeBtn) await closeBtn.click();
    await p.waitForTimeout(600);
  }

  // 2. Select a server and channel
  console.log("Selecting server and channel...");
  const srvIcos = await p.$$(".rail-ico");
  for (const ic of srvIcos) {
    const t = await ic.getAttribute("title");
    if (t && !/Home|Create/.test(t)) {
      await ic.click();
      break;
    }
  }
  await p.waitForTimeout(1200);

  const textChan = await p.$('.nav-item:has(.ch-hash:has-text("#"))');
  if (textChan) {
    await textChan.click();
    await p.waitForTimeout(1000);
  }

  // 3. Test typing tactile feedback in chat composer
  console.log("Testing typing & message send cues...");
  const textarea = await p.$('.composer textarea');
  if (textarea) {
    await textarea.click();
    await p.waitForTimeout(200);
    // Type text character by character to fire keystroke cues
    await textarea.type("Soothing clicky VS Code sounds in SignalTeams! 🎧", { delay: 40 });
    await p.waitForTimeout(500);

    // Send the message
    await textarea.press("Enter");
    await p.waitForTimeout(1200);

    // Add reaction to the sent message
    const lastMsg = await p.$('.msgs .msg:last-child');
    if (lastMsg) {
      await lastMsg.hover();
      await p.waitForTimeout(400);
      const reactChip = await p.$('.react-bar span:first-child');
      if (reactChip) {
        await reactChip.click();
        await p.waitForTimeout(600);
      }
    }

    // Capture screenshot of active chat with sent message & reaction
    await p.screenshot({ path: "qa/qa-audio-chat.png" });
    console.log("Saved qa/qa-audio-chat.png");
  }

  await browser.close();
  console.log("Console errors encountered:", consoleErrors.length);
  if (consoleErrors.length > 0) {
    console.warn("Errors:", consoleErrors);
  }
  console.log("QA Audio Cues test finished successfully!");
}

run().catch((err) => {
  console.error("QA Audio Cues failed:", err);
  process.exit(1);
});
