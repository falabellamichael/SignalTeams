export default async function run(page, ui) {
  const out = { shots: [] };
  const shot = async (n) => { await page.screenshot({ path: `D:/AgentHive/qa/m-${n}.png` }); out.shots.push("m-" + n); };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://localhost:8075/?cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
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
  // server → workspace nav row
  await page.$$eval(".rail .rail-ico", (els) => (els[1] || els[0])?.click());
  await page.waitForTimeout(1200);
  if (!(await page.$(".side-wrap.open"))) await page.$eval(".burger", (b) => b.click());
  await page.waitForTimeout(500);
  await page.waitForSelector(".ws-nav", { timeout: 8000 }).catch(() => {});
  out.wsRows = (await page.$$(".ws-nav")).length;
  if (out.wsRows) {
    await page.$$eval(".ws-nav", (els) => els[0].click());
    await page.waitForTimeout(1800);
    await shot("23-ws");
    // measure: does the ws layout overflow the viewport?
    out.overflow = await page.evaluate(() => {
      const b = document.body;
      return { scrollW: b.scrollWidth, innerW: window.innerWidth,
               hscroll: b.scrollWidth > window.innerWidth + 2 };
    });
    // open first file in the tree if present
    const treeFile = await page.$(".ws-tree .file, .ws-tree [class*='file']");
    out.treeFileFound = !!treeFile;
    if (treeFile) { await treeFile.click(); await page.waitForTimeout(1200); await shot("24-ws-file"); }
    // overflow after file open (editor)
    out.overflow2 = await page.evaluate(() => document.body.scrollWidth > window.innerWidth + 2);
  }
  return out;
}
