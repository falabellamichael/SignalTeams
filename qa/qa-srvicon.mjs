import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";
const B = "http://127.0.0.1:8075";
const errors = [], failed = [];
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("requestfailed", (r) => failed.push(r.url()));
page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
await page.goto(B, { waitUntil: "networkidle" });
await page.click('button:has-text("crew account")');
await page.fill('input:not([type])', "mike");
await page.locator('input[type="password"]').first().fill("password");
await page.click('button:has-text("Sign in"), button:has-text("sign in")');
await page.waitForSelector(".rail", { timeout: 10000 });
await page.waitForTimeout(900);

// rail shows the uploaded image icon?
const railImg = await page.locator(".rail-ico .rail-ico-img").count();
console.log("rail icon imgs:", railImg);

// open the server → sidebar header shows image too
for (const ic of await page.$$(".rail-ico")) {
  const t = await ic.getAttribute("title");
  if (t && !/Home|Create/.test(t)) { await ic.click(); break; }
}
await page.waitForTimeout(1100);
const headImg = await page.locator(".side-head .name img").count();
console.log("sidebar head img:", headImg);

// settings modal — gear → icon section has upload/replace + clear
await page.click(".srv-gear");
await page.waitForTimeout(900);
console.log("replace btn:", await page.locator('button:has-text("replace image")').count(),
  "| clear btn:", await page.locator('button:has-text("clear")').count(),
  "| preview img:", await page.locator(".modal img").count());

// clear via the button → rail falls back to emoji
await page.click('button:has-text("clear")');
await page.waitForTimeout(900);
const afterClear = await page.locator(".rail-ico .rail-ico-img").count();
console.log("rail imgs after clear:", afterClear);
await page.screenshot({ path: "qa-srvicon.png" });

// restore the icon so the app isn't left icon-less
await page.evaluate(async () => {
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAATSURBVBhXY/iPAQwMDAxMIP4/AwMAmR4YEd6T7cMAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
  const fd = new FormData();
  fd.append("file", new File([png], "icon.png", { type: "image/png" }));
  const up = await (await fetch("/api/upload", { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("st_token") || localStorage.getItem("token")}` }, body: fd })).json();
  const sid = document.querySelector(".rail-ico[title]:not([title*='Home']):not([title*='Create'])")?.title ? 1 : 1;
  await fetch(`/api/servers/1`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("st_token") || localStorage.getItem("token")}` }, body: JSON.stringify({ icon_file: up.id }) });
});
await page.waitForTimeout(700);
console.log("restored:", await page.locator(".rail-ico .rail-ico-img").count());
await page.screenshot({ path: "qa-srvicon2.png" });
console.log("CONSOLE:", errors.length ? errors.slice(0, 4) : "clean");
console.log("FAILED:", failed.length ? failed.slice(0, 4) : "none");
await browser.close();
