export default async function run(page, ui) {
  await page.goto("http://localhost:5175/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  return await page.evaluate(async () => {
    const out = {};
    for (const p of [
      "/src/components/workspace/WorkspaceChat.jsx",
      "/src/components/Workspace.jsx",
    ]) {
      try {
        const t = await (await fetch(p, { cache: "no-store" })).text();
        out[p] = {
          hasOldBar: t.includes("ws-chat-bar"),
          hasMembersProp: /members\s*=\s*\{members\}/.test(t) || t.includes("members: members"),
          hasTabAdd: t.includes("ws-tab-add"),
          hasSomeGuard: t.includes("tabs.some"),
          len: t.length,
        };
      } catch (e) { out[p] = String(e); }
    }
    return out;
  });
}
