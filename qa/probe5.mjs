import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const out = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.title === 'Join voice')
    if (!b) return { found: false }
    b.addEventListener('click', () => { window.__joinClicked = (window.__joinClicked || 0) + 1 }, true)
    const r = b.getBoundingClientRect()
    return { found: true, r: { x: r.x, y: r.y, w: r.width, h: r.height } }
  })
  if (!out.found) return out
  await page.mouse.click(out.r.x + out.r.w / 2, out.r.y + out.r.h / 2)
  await sleep(2500)
  return await page.evaluate(() => ({
    clicked: window.__joinClicked || 0,
    gum: window.__gumCalled,
    bar: !!document.querySelector('.voice-bar'),
    err: document.querySelector('.send-err')?.textContent || null,
  }))
}
