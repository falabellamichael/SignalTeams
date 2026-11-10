import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await page.goto('http://localhost:5175/?s=' + Date.now(), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.rail', { timeout: 25000 })
  await desk(page); await sleep(1500)
  const out = {}
  const clickEl = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s)
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return !!el
  }, sel)
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('Mike'))
    n?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(1000)
  // still in voice? if not, rejoin quickly
  if (!(await page.locator('.voice-bar').count())) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => /^join voice$/i.test(x.title))
      b?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    for (let i = 0; i < 12 && !(await page.locator('.voice-bar').count()); i++) await sleep(500)
  }
  out.bar = await page.locator('.voice-bar').count()
  out.tiles = await page.locator('.vs-tile').count()
  out.geo = await page.evaluate(() => {
    const t = document.querySelector('.vs-tile')
    if (!t) return null
    const r = t.getBoundingClientRect()
    const v = t.querySelector('video.on')
    return { w: Math.round(r.width), h: Math.round(r.height), vidPlaying: v && !v.paused && v.readyState > 1 }
  })
  // flip → tile must NOT resize
  const before = out.geo
  await clickEl('.vs-flip'); await sleep(700)
  const after = await page.evaluate(() => {
    const r = document.querySelector('.vs-tile')?.getBoundingClientRect()
    return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null
  })
  out.sameBox = before && after && before.w === after.w && before.h === after.h
  await page.screenshot({ path: 'qa/shots/74-tiles.png' })
  // expand once more for the final look
  await clickEl('.vs-tile'); await sleep(800)
  out.focused = await page.locator('.vs-focus').count()
  await page.screenshot({ path: 'qa/shots/75-final.png' })
  return out
}
