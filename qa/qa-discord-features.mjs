import { chromium } from "file:///D:/VehicleSite/node_modules/playwright/index.mjs";

async function run() {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  
  // Login as mike
  const r = await ctx.request.post("http://127.0.0.1:8075/api/login", {
    data: { username: "mike", password: "password" }
  });
  const data = await r.json();
  const token = data.token;
  console.log("Logged in:", !!token);

  // Update profile
  await ctx.request.patch("http://127.0.0.1:8075/api/me", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      banner_color: "#5865F2",
      pronouns: "they/them",
      about: "Chief Signal Architect & Discord Enthusiast"
    }
  });

  // Get servers to post embed
  const srvRes = await ctx.request.get("http://127.0.0.1:8075/api/servers", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const servers = await srvRes.json();
  const sid = servers[0].id;
  const srvDetail = await (await ctx.request.get(`http://127.0.0.1:8075/api/servers/${sid}`, {
    headers: { Authorization: `Bearer ${token}` }
  })).json();
  const chan = srvDetail.channels.find(c => c.kind === "text");

  // Post rich embed
  await ctx.request.post(`http://127.0.0.1:8075/api/channels/${chan.id}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      content: "Discord Rich Embed Card Demo",
      embed: {
        title: "🚀 SignalTeams Discord Engine",
        description: "Backwards-engineering Discord UI and capabilities directly into SignalTeams.",
        color: "#5865F2",
        author: { name: "Mike Anthony" },
        fields: [
          { name: "Rich Embeds", value: "Verified ✅", inline: true },
          { name: "User Profiles", value: "Verified ✅", inline: true },
          { name: "Slash Commands", value: "Verified ✅", inline: true }
        ],
        footer: { text: "SignalTeams Core Engine" }
      }
    }
  });

  await ctx.addInitScript((t) => localStorage.setItem("signalteams.token", t), token);
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8075", { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".rail", { timeout: 15000 });
  await p.waitForTimeout(1000);

  // Click server icon
  const icos = await p.$$(".rail-ico");
  for (const ic of icos) {
    const t = await ic.getAttribute("title");
    if (t && !/Home|Create/.test(t)) {
      await ic.click();
      break;
    }
  }
  await p.waitForTimeout(1200);

  // Ensure text channel is selected
  const chanEl = await p.$(`.nav-item:has-text("${chan.name}")`);
  if (chanEl) await chanEl.click();
  await p.waitForTimeout(2000);

  // Check if discord-embed exists
  const embedCount = await p.$$eval(".discord-embed", els => els.length);
  console.log("Found discord-embed cards:", embedCount);

  // Screenshot embed in chat
  await p.screenshot({ path: "qa/qa-discord-embed.png" });
  console.log("Saved qa/qa-discord-embed.png");

  // Open profile modal by clicking an author or avatar
  const authorEl = await p.$(".msg .author, .msg .avatar");
  if (authorEl) {
    console.log("Clicking author/avatar...");
    await authorEl.click();
    await p.waitForSelector(".profile-modal", { timeout: 6000 });
    await p.waitForTimeout(1000);
    await p.screenshot({ path: "qa/qa-discord-profile.png" });
    console.log("Saved qa/qa-discord-profile.png");
  } else {
    console.log("No author/avatar found in messages");
  }

  // Test slash command expansion in chat input
  const chatInput = await p.$('textarea.chat-input, input.chat-input, .chat-input textarea, textarea');
  if (chatInput) {
    await chatInput.fill("/flip");
    await p.keyboard.press("Enter");
    await p.waitForTimeout(1000);
    await p.screenshot({ path: "qa/qa-discord-slash.png" });
    console.log("Saved qa/qa-discord-slash.png");
  }

  await b.close();
}

run().catch(err => {
  console.error("QA error:", err);
  process.exit(1);
});
