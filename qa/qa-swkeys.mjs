import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";
const errors = [];
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://127.0.0.1:8075", { waitUntil: "networkidle" });
await page.click('button:has-text("crew account")');
await page.fill('input:not([type])', "mike");
await page.locator('input[type="password"]').first().fill("password");
await page.click('button:has-text("Sign in"), button:has-text("sign in")');
await page.waitForSelector(".rail", { timeout: 10000 });
await page.waitForTimeout(1600);
await page.keyboard.press("Control+k");
await page.waitForSelector(".modal input");
await page.fill(".modal input", "star");
await page.waitForTimeout(1200);
console.log("row0 on:", await page.locator(".jump-row.on").count());
await page.keyboard.press("ArrowDown");   // → first message hit or clamps
await page.waitForTimeout(300);
await page.keyboard.press("ArrowUp");     // back to row 0
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
await page.waitForTimeout(1500);
console.log("landed ph:", await page.locator("textarea").last().getAttribute("placeholder").catch(() => "none"));
console.log("CONSOLE:", errors.length ? errors.slice(0, 3) : "clean");
await browser.close();
