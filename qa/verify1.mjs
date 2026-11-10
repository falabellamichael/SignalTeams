import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await page.reload(); await sleep(1800); await desk(page)
  // go to the server channel
  await page.locator('.rail-ico').nth(1).click()
  await sleep(1200)
  // hover the second message and measure react-bar coverage
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
      barVisible: cs.opacity === '1',
      coversCenter: cx >= br.left && cx <= br.right && cy >= br.top && cy <= br.bottom,
      topAtCenter: document.elementFromPoint(cx, cy)?.tagName + '.' + (document.elementFromPoint(cx, cy)?.className || ''),
    };
  });
  const me = await page.evaluate(() =>
    [...document.querySelectorAll('*')].find(e => /@falabellasocial ·/.test(e.textContent) && e.children.length === 0)?.textContent);
  await page.screenshot({ path: 'qa/shots/30-verify-bar.png' })
  return { info, me }
}
