import { chromium } from "file:///C:/Users/Falab/edge-mcp/node_modules/playwright-core/index.mjs";
const b = await chromium.connectOverCDP("http://localhost:9333");
const ctx = b.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("127.0.0.1:8075")) || ctx.pages()[0];
console.log("page:", page.url().slice(0, 60));
// 1) raw window.open to [::1] probe — non-app origin → must route to system browser
const ret = await page.evaluate(() => {
  const w = window.open("http://[::1]:9999/cdp-probe", "_blank");
  return w === null ? "null(denied)" : "handle";
});
console.log("window.open returned:", ret);
await new Promise(r => setTimeout(r, 3000));
await b.close();
