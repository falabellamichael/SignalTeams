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

  console.log("Navigating to http://localhost:5175...");
  await p.goto("http://localhost:5175", { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".rail", { timeout: 15000 });
  await p.waitForTimeout(1000);

  // Navigate to first server
  const srvIcos = await p.$$(".rail-ico");
  for (const ic of srvIcos) {
    const t = await ic.getAttribute("title");
    if (t && !/Home|Create/.test(t)) {
      await ic.click();
      break;
    }
  }
  await p.waitForTimeout(1200);

  console.log("Looking for category in sidebar...");
  const catHeader = p.locator('.side-group.cat').first();
  const catCount = await catHeader.count();
  console.log(`Found ${catCount} categories`);

  if (catCount > 0) {
    // 1. Hover category to see gear icon and click it
    await catHeader.hover();
    const catGear = catHeader.locator('.ch-gear');
    console.log("Clicking category settings gear icon...");
    await catGear.click({ force: true });
    await p.waitForTimeout(800);

    const catModal = p.locator('.settings-modal');
    console.log("Category modal visible:", (await catModal.count()) > 0);
    const catTabs = await catModal.locator('.set-rail button').count();
    console.log("Category modal rail tabs count:", catTabs);

    // Switch to Permissions page
    const permsTab = catModal.locator('.set-rail button').nth(1);
    await permsTab.click();
    await p.waitForTimeout(500);

    await p.screenshot({ path: "D:/AgentHive/qa/shots/category-settings-overlay.png" });
    console.log("Saved category-settings-overlay.png");

    // Close category settings
    await catModal.locator('.modal-x').click();
    await p.waitForTimeout(600);
  }

  // 2. Open Channel Settings Overlay for first channel
  console.log("Opening Channel Settings Overlay...");
  const chGear = p.locator('.nav-item .ch-gear[title="Edit channel"]').first();
  await chGear.evaluate((el) => el.click());
  await p.waitForTimeout(800);

  const chanModal = p.locator('.settings-modal');
  console.log("Channel settings modal visible:", (await chanModal.count()) > 0);
  const chanTabs = await chanModal.locator('.set-rail button').count();
  console.log(`Channel settings tabs count: ${chanTabs}`);

  // Test tabs navigation
  console.log("Switching through Channel Settings tabs...");
  for (let i = 0; i < chanTabs; i++) {
    await chanModal.locator('.set-rail button').nth(i).click();
    await p.waitForTimeout(300);
  }

  await p.screenshot({ path: "D:/AgentHive/qa/shots/channel-settings-overlay.png" });
  console.log("Saved channel-settings-overlay.png");

  // Close channel settings
  await chanModal.locator('.modal-x').click();
  await p.waitForTimeout(600);

  // 3. Test Create Category via Header button
  console.log("Testing Create Category via sidebar...");
  const addCatBtn = p.locator('.side-group button[title="Create category"]');
  if (await addCatBtn.count() > 0) {
    await addCatBtn.click();
    await p.waitForTimeout(800);
    const newCatModal = p.locator('.settings-modal');
    console.log("New Category modal opened:", (await newCatModal.count()) > 0);

    const nameInput = newCatModal.locator('.set-body input').first();
    const testCatName = "DEV-TEAM";
    await nameInput.fill(testCatName);
    await p.waitForTimeout(300);

    console.log(`Creating category '${testCatName}'...`);
    await newCatModal.locator('.set-foot .primary').click();
    await p.waitForTimeout(1200);

    const createdCat = p.locator('.side-group.cat', { hasText: testCatName });
    console.log(`Created category in sidebar: ${(await createdCat.count()) > 0}`);
    await p.screenshot({ path: "D:/AgentHive/qa/shots/new-category-created.png" });
    console.log("Saved new-category-created.png");
  }

  await browser.close();
  console.log("QA run finished successfully!");
}

run().catch((e) => {
  console.error("QA error:", e);
  process.exit(1);
});
