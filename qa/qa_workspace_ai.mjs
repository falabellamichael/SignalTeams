import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";
import path from "path";

const ARTIFACT_DIR = "C:/Users/Falab/.gemini/antigravity-cli/brain/03ddf11f-f01a-4914-9316-6ca8c2ce2d0f";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
  });

  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 850 }
  });

  // Login as mike
  const r = await ctx.request.post("http://127.0.0.1:8075/api/login", {
    data: { username: "mike", password: "password" }
  });
  const { token } = await r.json();
  await ctx.addInitScript((t) => localStorage.setItem("signalteams.token", t), token);

  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
      console.error("Browser Console Error:", msg.text());
    }
  });

  console.log("Navigating to http://localhost:5175...");
  await page.goto("http://localhost:5175", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".rail", { timeout: 15000 });
  await page.waitForTimeout(1000);

  // Click on the server (nth=1)
  console.log("Selecting server...");
  await page.click(".rail-ico >> nth=1").catch(() => {});
  await page.waitForTimeout(1200);

  // Click on workspace in the sidebar
  console.log("Selecting workspace...");
  const wsNav = page.locator(".ws-nav").first();
  await wsNav.waitFor({ state: "visible", timeout: 5000 });
  await wsNav.click();
  await page.waitForTimeout(1500);

  // Switch to Chat in workspace
  console.log("Switching to workspace chat...");
  const chatBtn = page.locator('.ws-view button:has-text("chat"), .ws-tab:has-text("Chat")').first();
  if (await chatBtn.isVisible()) {
    await chatBtn.click();
  }
  await page.waitForSelector(".ws-chat, .chat", { timeout: 10000 });
  await page.waitForTimeout(1000);

  // Find the AI options dropdown button in channel tools
  console.log("Locating AI dropdown button...");
  const aiTrigger = page.locator(".ai-split button").first();
  await aiTrigger.waitFor({ state: "visible", timeout: 5000 });
  await aiTrigger.click();
  await page.waitForTimeout(400);

  const aiPanel = page.locator(".ai-panel");
  await aiPanel.waitFor({ state: "visible", timeout: 3000 });

  // Locate the "Web search" toggle item
  const webItem = page.locator(".ai-item:has-text('Web search')").first();
  await webItem.waitFor({ state: "visible", timeout: 3000 });

  const initiallyOn = await webItem.evaluate((el) => el.classList.contains("on"));
  console.log(`Initial Web Search state: ${initiallyOn ? "ON" : "OFF"}`);

  // Click Web search toggle
  console.log("Toggling Web search...");
  await webItem.click();

  // Check state after click (optimistic update should be immediate <100ms)
  await page.waitForTimeout(100);
  const nowOn = await webItem.evaluate((el) => el.classList.contains("on"));
  console.log(`Web Search state after 1st click: ${nowOn ? "ON" : "OFF"}`);

  if (nowOn === initiallyOn) {
    throw new Error(`FAIL: Click did not immediately change the toggle state! initiallyOn=${initiallyOn}, nowOn=${nowOn}`);
  }

  // Also toggle Speech to text
  const sttItem = page.locator(".ai-item:has-text('Speech to text')").first();
  const sttInitiallyOn = await sttItem.evaluate((el) => el.classList.contains("on"));
  console.log(`Initial Speech to text state: ${sttInitiallyOn ? "ON" : "OFF"}`);

  await sttItem.click();
  await page.waitForTimeout(100);
  const sttNowOn = await sttItem.evaluate((el) => el.classList.contains("on"));
  console.log(`Speech to text state after click: ${sttNowOn ? "ON" : "OFF"}`);

  if (sttNowOn === sttInitiallyOn) {
    throw new Error(`FAIL: STT click did not immediately change the toggle state!`);
  }

  // Take screenshot with AI panel open and toggles visibly on
  const shotPath = path.join(ARTIFACT_DIR, "qa-workspace-ai-toggle.png");
  await page.screenshot({ path: shotPath });
  console.log(`Screenshot saved to ${shotPath}`);

  // Now toggle both back off
  console.log("Toggling back off to verify both directions work instantaneously...");
  await webItem.click();
  await page.waitForTimeout(100);
  const webFinal = await webItem.evaluate((el) => el.classList.contains("on"));
  console.log(`Web search state after toggle back: ${webFinal ? "ON" : "OFF"}`);

  await sttItem.click();
  await page.waitForTimeout(100);
  const sttFinal = await sttItem.evaluate((el) => el.classList.contains("on"));
  console.log(`STT state after toggle back: ${sttFinal ? "ON" : "OFF"}`);

  if (webFinal !== initiallyOn || sttFinal !== sttInitiallyOn) {
    throw new Error(`FAIL: Toggles did not return to original state!`);
  }

  console.log("SUCCESS: Workspace AI options toggle instantaneously in both directions without page reloads!");
  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
