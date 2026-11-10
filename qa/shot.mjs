import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await sleep(400)
  await page.screenshot({ path: 'qa/shots/63-now.png' })
  return await page.evaluate(() => ({
    overlay: [...document.querySelectorAll('.modal, .shade, .menu-scrim, .scrim')]
      .filter((o) => { const s = getComputedStyle(o); return s.display !== 'none' && s.visibility !== 'hidden' })
      .map((o) => o.className),
    joinPt: (() => { const b = [...document.querySelectorAll('button')].find((x) => x.title === 'Join voice');
      if (!b) return null; const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el ? el.tagName + '.' + String(el.className).slice(0, 40) : 'none' })(),
  }))
}
