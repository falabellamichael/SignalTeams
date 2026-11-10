import { sleep } from './lib.mjs'
export default async function run(page, ui) {
  const out = {}
  // what's covering the nav item?
  out.cover = await page.evaluate(() => {
    const n = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('Mike'))
    if (!n) return 'none'
    const r = n.getBoundingClientRect()
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return { nav: r.toJSON(), top: el ? `${el.tagName}.${String(el.className).slice(0, 40)}` : 'null' }
  })
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('Mike'))
    n?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(1200)
  out.head = await page.locator('.chan-head').first().textContent().catch(() => '')
  out.join = await page.locator('button[title*="voice" i]').count()
  out.joinTitles = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.title).filter(t => /voice|call|camera/i.test(t)))
  return out
}
