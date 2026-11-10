import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.locator('.rail-ico').nth(1).click()
  await sleep(1400)
  const info = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.msg .text')].find(e => e.textContent.includes('hello from the new'));
    if (!el) return { err: 'no el' };
    const r = el.getBoundingClientRect();
    const msg = el.closest('.msg');
    msg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bar = msg.querySelector('.react-bar');
    const br = bar.getBoundingClientRect();
    const cs = getComputedStyle(bar);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return {
      msgW: Math.round(r.width), cx: Math.round(cx), cy: Math.round(cy),
      bar: { l: Math.round(br.left), t: Math.round(br.top), w: Math.round(br.width), h: Math.round(br.height) },
      barOpacity: cs.opacity,
      coversCenter: cx >= br.left && cx <= br.right && cy >= br.top && cy <= br.bottom,
      topAtCenter: (() => { const t = document.elementFromPoint(cx, cy); return t ? t.tagName + '.' + (t.className || '') : null })(),
      items: bar.children.length,
    };
  });
  // now try the real hover + right-click that timed out before
  const msg = page.locator('.msg .text', { hasText: 'hello from the new account' })
  await msg.click({ button: 'right', timeout: 6000 })
  await sleep(600)
  await page.screenshot({ path: 'qa/shots/31-ctxmenu.png' })
  const snap = await ui.snapshot()
  return { info, menuOpen: snap.includes('Forward') || snap.includes('Reply'), snap: snap.slice(-1200) }
}
