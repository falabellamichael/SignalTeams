import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const r = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.title === 'Join voice')
    if (!btn) return { found: false }
    const x = btn.getBoundingClientRect()
    const el = document.elementFromPoint(x.x + x.width / 2, x.y + x.height / 2)
    const overlays = [...document.querySelectorAll('.modal, .menu-scrim, .mention-pop, .pop, [class*="scrim"], [class*="overlay"]')]
      .filter((o) => { const s = getComputedStyle(o); return s.display !== 'none' && s.visibility !== 'hidden' })
      .map((o) => o.className)
    return { found: true, rect: { x: x.x, y: x.y, w: x.width, h: x.height }, atPoint: el ? el.tagName + '.' + el.className : 'none', overlays }
  })
  await page.screenshot({ path: 'qa/shots/62-probe.png' })
  return r
}
