export default async function run(page, ui) {
  const out = { shots: [] };
  const shot = async (n) => { await page.screenshot({ path: `D:/AgentHive/qa/m-${n}.png` }); out.shots.push("m-" + n); };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  let snap = await ui.snapshot();
  const crew = snap.match(/@(e\d+) button "crew account"/)?.[1];
  if (crew) { await ui.click(crew); await page.waitForTimeout(400); snap = await ui.snapshot(); }
  const boxes = [...snap.matchAll(/@(e\d+) textbox/g)].map((m) => m[1]);
  if (boxes.length >= 2) {
    await ui.fill("@" + boxes[0], "mike"); await ui.fill("@" + boxes[1], "password");
    await ui.click(snap.match(/@(e\d+) button "Sign in"/)?.[1]);
    await page.waitForTimeout(3000);
  }

  const openDrawer = async () => {
    if (!(await page.$(".side-wrap.open"))) {
      await page.$eval(".burger", (b) => b.click());
      await page.waitForTimeout(500);
    }
    out.drawer = !!(await page.$(".side-wrap.open"));
  };

  // 1) settings modal via MeBar gear (DOM click bypasses coverage quirks)
  await openDrawer();
  await page.$eval(".me-btn[title='Settings']", (b) => b.click());
  await page.waitForTimeout(900);
  out.modalOpen = !!(await page.$(".settings-modal"));
  await shot("9-settings");
  // mesh page
  const railBtns = await page.$$(".set-rail button");
  out.railCount = railBtns.length;
  for (const b of railBtns) {
    const t = await b.getAttribute("title");
    if (t === "Nexus Mesh") { await b.click(); break; }
  }
  await page.waitForTimeout(1500);
  await shot("10-mesh");
  await page.$eval(".modal-x", (b) => b.click()).catch(() => {});
  await page.waitForTimeout(400);

  // 2) DM — drawer → last nav item is a DM row
  await openDrawer();
  await page.$$eval(".nav-item", (els) => els[els.length - 1].click());
  await page.waitForTimeout(1400);
  await shot("11-dm");

  // 3) agent library — drawer → nav item by text
  await openDrawer();
  await page.$$eval(".nav-item", (els) => {
    const t = els.find((e) => /Library/.test(e.textContent)); (t || els[0]).click();
  });
  await page.waitForTimeout(1400);
  await shot("12-library");
  return out;
}
