export default async function run(page, ui) {
  await page.waitForTimeout(800);
  const snap = await ui.snapshot();
  const boxes = [...snap.matchAll(/@(e\d+) textbox/g)].map(m => m[1]);
  if (boxes.length >= 2) {
    await ui.fill(boxes[0], 'mike');
    await ui.fill(boxes[1], 'password');
    const btn = snap.match(/@(e\d+) button/)?.[1];
    if (btn) await ui.click(btn);
    await page.waitForSelector('.side-wrap', { timeout: 8000 });
    await page.waitForTimeout(1200);
  }
  return { ok: await page.locator('.side-wrap').count() };
}
