import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";
const b = await chromium.launch();
const ctx = await b.newContext();
const r = await ctx.request.post("http://127.0.0.1:8075/api/login",
  { data: { username: "mike", password: "password" } });
await ctx.addInitScript((t) => localStorage.setItem("signalteams.token", t), (await r.json()).token);
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:8075", { waitUntil: "domcontentloaded" });
await p.waitForSelector(".rail", { timeout: 20000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: "qa-sweep.png", fullPage: false });
await b.close();
