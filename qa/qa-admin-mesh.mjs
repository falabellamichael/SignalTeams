export default async function run(page, ui) {
  // inject admin session then reload so the app boots authed
  await page.evaluate(() => localStorage.setItem("signalteams.token", "qa3-oKrvMKbT9zh24HAO1O15XQ"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const me = await page.evaluate(async () =>
    (await fetch("/api/me", { headers: { Authorization: "Bearer " + localStorage.getItem("signalteams.token") } })).json());
  const out = { me: { username: me.username, is_admin: me.is_admin } };

  // open settings via the MeBar gear (bottom-left)
  let snap = await ui.snapshot();
  const gear = snap.match(/@(e\d+) button "Settings"/)?.[1]
    || snap.match(/@(e\d+) button[^\n]*gear/i)?.[1];
  if (!gear) return { ...out, error: "no settings gear", snap };
  await ui.click(gear);
  await page.waitForTimeout(800);

  snap = await ui.snapshot();
  out.settingsOpened = /Appearance|Nexus Mesh/i.test(snap);
  // list rail buttons to see which icons exist
  out.railButtons = await page.$$eval(".set-rail button",
    (bs) => bs.map((b) => b.getAttribute("title") || b.getAttribute("aria-label") || b.textContent.trim()));

  // click the mesh page (dish icon) if present
  const meshBtn = snap.match(/@(e\d+) button "Nexus Mesh"/)?.[1];
  out.meshInRail = !!meshBtn;
  if (meshBtn) {
    await ui.click(meshBtn);
    await page.waitForTimeout(3000);
    out.meshSnap = (await ui.snapshot({ full: true })).slice(0, 3000);
  }
  await page.screenshot({ path: "D:/AgentHive/qa/qa-admin-mesh.png" });
  return out;
}
