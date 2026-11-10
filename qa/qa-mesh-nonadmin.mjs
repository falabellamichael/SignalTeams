export default async function run(page, ui) {
  await page.evaluate(() => localStorage.setItem("signalteams.token", "qa4-7rw7gIrckAh8vMfmjIJyxQ"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  let snap = await ui.snapshot();
  const gear = snap.match(/@(e\d+) button "Settings"/)?.[1];
  await ui.click(gear);
  await page.waitForTimeout(800);
  snap = await ui.snapshot();
  const meshBtn = snap.match(/@(e\d+) button "Nexus Mesh"/)?.[1];
  const out = { meshInRail: !!meshBtn };
  if (meshBtn) {
    await ui.click(meshBtn);
    await page.waitForTimeout(2500);
    const tree = await ui.snapshot({ full: true });
    out.hasViewOnly = tree.includes("view only");
    out.hasConnectBtn = /button "Connect"/.test(tree);
    out.hasDisconnectBtn = /button "Disconnect"/.test(tree);
    out.hasMintCode = /Mint code/.test(tree);
    out.hasHowToJoin = /Ask an admin for an/.test(tree);
    await page.screenshot({ path: "D:/AgentHive/qa/qa-mesh-nonadmin.png" });
  }
  return out;
}
