export default async function run(page, ui) {
  await page.waitForTimeout(800);
  // log in if the login form is up
  const snap = await ui.snapshot();
  if (snap.includes('textbox') || snap.includes('password')) {
    const user = snap.match(/@(e\d+) textbox/i)?.[1];
    const pass = snap.match(/@(e\d+) password|@(e\d+) textbox.*password/i)?.[1];
    const btn = snap.match(/@(e\d+) button/i)?.[1];
    const boxes = [...snap.matchAll(/@(e\d+) textbox/g)].map(m => m[1]);
    if (boxes.length >= 2) {
      await ui.fill(boxes[0], 'mike');
      await ui.fill(boxes[1], 'password');
    }
    if (btn) await ui.click(btn);
    await page.waitForTimeout(1500);
  }
  const m = await page.evaluate(() => {
    const pick = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { h: r.height, top: r.top, bottom: r.bottom, display: cs.display,
               flexDirection: cs.flexDirection, flex: cs.flex, position: cs.position };
    };
    return {
      inner: { w: innerWidth, h: innerHeight },
      app: pick('.app'),
      wrap: pick('.side-wrap'),
      side: pick('.side'),
      body: pick('.side-body'),
      mebar: pick('.me-bar'),
      rootH: document.getElementById('root')?.getBoundingClientRect().height,
      bodyH: document.body.getBoundingClientRect().height,
    };
  });
  return m;
}
