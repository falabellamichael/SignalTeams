export default async function run(page, ui) {
  await page.goto("http://localhost:5175/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // what module URLs did the page actually load?
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll("script")].map((s) => s.src).filter(Boolean));

  // fetch the WorkspaceChat module the page is using and look for the old bar
  const probe = await page.evaluate(async () => {
    const urls = performance.getEntriesByType("resource")
      .map((e) => e.name)
      .filter((n) => n.includes("WorkspaceChat") || n.includes("Workspace.jsx"));
    const out = {};
    for (const u of urls) {
      try {
        const t = await (await fetch(u, { cache: "no-store" })).text();
        out[u.split("/").pop()] = {
          hasOldBar: t.includes("ws-chat-bar"),
          hasMembers: t.includes("members"),
          len: t.length,
        };
      } catch (e) { out[u] = String(e); }
    }
    return { urls, out };
  });

  return { scripts, probe };
}
