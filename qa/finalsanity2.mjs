import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  const out = {}
  await page.addInitScript(() => {
    const fake = (color) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180
      const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 320, 180)
      let hue = 0
      setInterval(() => { x.fillStyle = `hsl(${hue = (hue + 5) % 360},60%,38%)`; x.fillRect(0, 0, 320, 180) }, 120)
      return c.captureStream(15)
    }
    const md = { getUserMedia: async () => fake("#28527a"),
                 getDisplayMedia: async () => fake("#7a3b2e") }
    Object.defineProperty(navigator, "mediaDevices", { get: () => md, configurable: true })
  })
  await page.goto('http://localhost:5175/?s=' + Date.now(), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.rail', { timeout: 25000 })
  await desk(page); await sleep(1500)
  const clickEl = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s)
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return !!el
  }, sel)
  const clickTitle = (src) => page.evaluate((s) => {
    const rx = new RegExp(s, 'i')
    const b = [...document.querySelectorAll('button')].find(x => rx.test(x.title))
    b?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return b ? b.title : null
  }, src)
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('Mike'))
    n?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(1200)
  await clickTitle('^Join voice$')
  for (let i = 0; i < 14 && !(await page.locator('.voice-bar').count()); i++) await sleep(500)
  out.bar = await page.locator('.voice-bar').count()
  await clickTitle('camera'); await sleep(1400)
  await clickTitle('screen'); await sleep(1700)
  out.tiles = await page.locator('.vs-tile').count()
  const box = () => page.evaluate(() => {
    const r = document.querySelector('.vs-tile')?.getBoundingClientRect()
    const v = document.querySelector('.vs-tile video.on')
    return r ? { w: Math.round(r.width), h: Math.round(r.height), playing: v && !v.paused && v.readyState > 1 } : null
  })
  out.before = await box()
  await clickEl('.vs-flip'); await sleep(700)
  out.after = await box()
  out.sameBox = out.before && out.after && out.before.w === out.after.w && out.before.h === out.after.h
  out.name = await page.locator('.vs-name').first().textContent().catch(() => '')
  await page.screenshot({ path: 'qa/shots/74-tiles.png' })
  await clickEl('.vs-tile'); await sleep(900)
  out.focused = await page.locator('.vs-focus').count()
  out.strip = await page.locator('.voice-stage .vs-tile').count()
  await page.screenshot({ path: 'qa/shots/75-final.png' })
  return out
}
