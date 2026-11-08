export default async function run(page, ui) {
  const out = { probes: [] };
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });
  await page.waitForTimeout(1500);

  // pin a big knot on screen, then cycle themes — content:url should swap it
  await page.evaluate(() => {
    const img = document.createElement("img");
    img.className = "typknot qa-probe";
    img.src = "/brand/knot-loop.png";
    img.style.cssText =
      "position:fixed;z-index:9999;width:96px;height:96px;left:24px;top:24px;" +
      "background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:8px";
    document.body.appendChild(img);
  });

  for (const t of ["dark", "obsidian", "light", "daylight"]) {
    await page.evaluate((tt) => { document.documentElement.dataset.theme = tt; }, t);
    await page.waitForTimeout(600);
    const probe = await page.evaluate(() => {
      const e = document.querySelector(".qa-probe");
      const cs = getComputedStyle(e);
      return {
        content: cs.content === "normal" ? e.getAttribute("src") : cs.content,
        bg: cs.backgroundColor,
      };
    });
    out.probes.push({ theme: t, ...probe });
    await page.screenshot({ path: `D:/AgentHive/qa-swap-${t}.png`, clip: { x: 8, y: 8, width: 160, height: 160 } });
  }
  return out;
}
