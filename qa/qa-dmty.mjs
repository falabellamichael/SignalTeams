import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";
const B = "http://127.0.0.1:8075";
const errors = [], failed = [];
const browser = await chromium.launch();
async function login(user) {
  const page = await (await browser.newContext()).newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${user}: ${m.text()}`); });
  page.on("requestfailed", (r) => failed.push(`${user}: ${r.url()}`));
  await page.goto(B, { waitUntil: "networkidle" });
  await page.click('button:has-text("crew account")');
  await page.fill('input:not([type])', user);
  await page.locator('input[type="password"]').first().fill("password");
  await page.click('button:has-text("Sign in"), button:has-text("sign in")');
  await page.waitForSelector(".rail", { timeout: 10000 });
  await page.waitForTimeout(1000);
  return page;
}
const mike = await login("mike"), nova = await login("nova");
// nova opens the mike DM (sidebar shows "Mike")
await nova.click('.nav-item:has-text("Mike")');
await nova.waitForTimeout(1200);
// mike stays home — his sidebar lists "Nova"
console.log("mike sees Nova row:", await mike.locator('.nav-item:has-text("Nova")').count());
// nova types
const box = nova.locator("textarea").last();
await box.click();
await box.pressSequentially("hello mike", { delay: 80 });
await mike.waitForTimeout(1200);
console.log("ty rows on mike:", await mike.locator(".dm-ty").count(),
  "| text:", (await mike.locator(".dm-ty .ch-vm").textContent().catch(() => "?") || "").trim());
await mike.screenshot({ path: "qa-dmty.png", clip: { x: 0, y: 120, width: 340, height: 560 } });
// typing stops (send or timeout → row clears)
await box.press("Enter");
await mike.waitForTimeout(1500);
console.log("after send:", await mike.locator(".dm-ty").count());
console.log("CONSOLE:", errors.length ? errors.slice(0, 4) : "clean");
console.log("FAILED:", failed.length ? failed.slice(0, 4) : "none");
await browser.close();
