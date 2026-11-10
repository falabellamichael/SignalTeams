export default async function run(page, ui) {
  await page.evaluate(() => localStorage.setItem("signalteams.token", "qa5-vBSRBySd5PBG3h2mEiTK1g"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  let snap = await ui.snapshot();
  const gear = snap.match(/@(e\d+) button "Settings"/)?.[1];
  await ui.click(gear);
  await page.waitForTimeout(800);
  snap = await ui.snapshot();
  await ui.click(snap.match(/@(e\d+) button "Nexus Mesh"/)?.[1]);
  await page.waitForTimeout(2500);
  // mint an invite so the ticket shows too
  const snap2 = await ui.snapshot();
  const mint = snap2.match(/@(e\d+) button "Mint code"/)?.[1];
  if (mint) { await ui.click(mint); await page.waitForTimeout(1200); }
  await page.screenshot({ path: "D:/AgentHive/qa/qa-mesh-pretty.png" });
  return { shot: "qa/qa-mesh-pretty.png" };
}
