export default async function run(page, ui) {
  const out = { shots: [] };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // crew tab then fill the two textboxes (username + password)
  let snap = await ui.snapshot();
  const crew = snap.match(/@(e\d+) button "crew account"/)?.[1];
  if (crew) { await ui.click(crew); await page.waitForTimeout(400); }
  snap = await ui.snapshot();
  const boxes = [...snap.matchAll(/@(e\d+) (?:textbox|input)/g)].map((m) => m[1]);
  out.boxes = snap.split("\n").filter((l) => /textbox|button/.test(l));
  if (boxes.length >= 2) {
    await ui.fill("@" + boxes[0], "mike");
    await ui.fill("@" + boxes[1], "password");
    await ui.click(snap.match(/@(e\d+) button "Sign in"/)?.[1]);
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: "D:/AgentHive/qa/m-2-home.png" }); out.shots.push("m-2-home");

  snap = await ui.snapshot();
  out.burger = /button "Menu"/.test(snap);
  const burger = snap.match(/@(e\d+) button "Menu"/)?.[1];
  if (burger) {
    await ui.click(burger); await page.waitForTimeout(500);
    await page.screenshot({ path: "D:/AgentHive/qa/m-3-drawer.png" }); out.shots.push("m-3-drawer");
    // pick the first server in the rail → channels → first channel
    snap = await ui.snapshot();
    const railBtn = [...snap.matchAll(/@(e\d+) button "[^\n]{1,30}"/g)]
      .map((m) => m[0]).filter((l) => !/Menu|Settings|Mute|Deafen|New|Mark|search|Inbox|Shortcuts|Notifications/.test(l));
    out.railBtns = railBtn;
    if (railBtn.length) {
      const ref = railBtn[railBtn.length - 1].match(/@(e\d+)/)[1];
      await ui.click("@" + ref); await page.waitForTimeout(1200);
      snap = await ui.snapshot();
      out.snap4 = snap.slice(0, 1200);
      const chan = [...snap.matchAll(/@(e\d+) (?:link|button|listitem|option) "?#?([a-z0-9-]{3,})"?/g)]
        .map((m) => m[1]);
      out.chanCands = chan.slice(0, 8);
      if (chan.length) {
        await ui.click("@" + chan[0]); await page.waitForTimeout(1500);
        await page.screenshot({ path: "D:/AgentHive/qa/m-4-chan.png" }); out.shots.push("m-4-chan");
      }
    }
  }
  return out;
}
