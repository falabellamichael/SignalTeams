import { sleep } from './lib.mjs'
export default async function run(page, ui) {
  const out = {}
  const click = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s)
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return !!el
  }, sel)
  const clickTitle = (re) => page.evaluate((src) => {
    const rx = new RegExp(src, 'i')
    const b = [...document.querySelectorAll('button')].find(x => rx.test(x.title))
    b?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return b ? b.title : null
  }, re.source)
  await clickTitle('^Join voice$')
  for (let i = 0; i < 12 && !(await page.locator('.voice-bar').count()); i++) await sleep(500)
  out.bar = await page.locator('.voice-bar').count()
  out.btns = await page.evaluate(() => [...document.querySelectorAll('.voice-bar button')].map(b => b.title))
  if (out.bar) {
    out.cam = await clickTitle('camera')
    await sleep(1400)
    out.share = await clickTitle('screen')
    await sleep(1600)
    out.tiles = await page.locator('.vs-tile').count()
    out.flip = await page.locator('.vs-flip').count()
    out.zbtn = await page.locator('.vs-zoom').count()
    out.vids = await page.locator('.vs-tile video').count()
    out.name1 = await page.locator('.vs-name').first().textContent().catch(() => '')
    if (out.flip) {
      await click('.vs-flip'); await sleep(800)
      out.name2 = await page.locator('.vs-name').first().textContent().catch(() => '')
      await page.screenshot({ path: 'qa/shots/60-strip.png' })
    }
    // click video → expand
    await page.evaluate(() => document.querySelector('.vs-tile video.on')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await sleep(800)
    out.zoomed = await page.locator('.feed-zoom').count()
    out.zvids = await page.locator('.fz-stage video').count()
    out.zname = await page.locator('.fz-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/61-zoomed.png' })
    // flip inside zoom
    out.zflip = await clickTitle('screen share|camera')
    await sleep(800)
    out.zname2 = await page.locator('.fz-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/62-zoomflip.png' })
    // Esc close
    await page.keyboard.press('Escape'); await sleep(600)
    out.closed = (await page.locator('.feed-zoom').count()) === 0
    // reopen, backdrop close
    await page.evaluate(() => document.querySelector('.vs-tile video.on')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await sleep(600)
    await page.mouse.click(40, 40); await sleep(600)
    out.closed2 = (await page.locator('.feed-zoom').count()) === 0
    await page.screenshot({ path: 'qa/shots/63-after.png' })
  }
  return out
}
