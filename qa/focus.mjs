import { sleep } from './lib.mjs'
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
  await page.goto('http://localhost:5175/?z=' + Date.now(), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.rail', { timeout: 25000 })
  await sleep(1600)
  const clickTitle = (src) => page.evaluate((s) => {
    const rx = new RegExp(s, 'i')
    const b = [...document.querySelectorAll('button')].find(x => rx.test(x.title))
    b?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return b ? b.title : null
  }, src)
  const clickEl = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s)
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return !!el
  }, sel)
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('Mike'))
    n?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(1200)
  await clickTitle('^Join voice$')
  for (let i = 0; i < 14 && !(await page.locator('.voice-bar').count()); i++) await sleep(500)
  out.bar = await page.locator('.voice-bar').count()
  if (out.bar) {
    await clickTitle('camera'); await sleep(1400)
    await clickTitle('screen'); await sleep(1700)
    out.tiles = await page.locator('.vs-tile').count()
    out.vids = await page.locator('.vs-tile video').count()
    // click the tile → focus fills chat area
    await clickEl('.vs-tile'); await sleep(900)
    out.focused = await page.locator('.vs-focus').count()
    out.msgsHidden = await page.evaluate(() => getComputedStyle(document.querySelector('.msgs')).display)
    out.stripStill = await page.locator('.voice-stage .vs-tile').count()
    out.composerVisible = await page.evaluate(() => {
      const c = document.querySelector('.composer'); const r = c.getBoundingClientRect()
      return { display: getComputedStyle(c).display, y: Math.round(r.y), h: Math.round(r.height) }
    })
    out.activeTile = await page.locator('.vs-tile.active').count()
    out.fname = await page.locator('.vsf-name').first().textContent().catch(() => '')
    out.fvids = await page.locator('.vs-focus video').count()
    await page.screenshot({ path: 'qa/shots/70-focus.png' })
    // flip inside focus
    await clickTitle('Show screen share|Show camera'); await sleep(800)
    out.fname2 = await page.locator('.vsf-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/71-focusflip.png' })
    // click the same strip tile → collapse
    await clickEl('.vs-tile'); await sleep(700)
    out.collapsed = (await page.locator('.vs-focus').count()) === 0
    out.msgsBack = await page.evaluate(() => getComputedStyle(document.querySelector('.msgs')).display)
    // reopen, Esc close
    await clickEl('.vs-tile'); await sleep(600)
    await page.keyboard.press('Escape'); await sleep(500)
    out.escClosed = (await page.locator('.vs-focus').count()) === 0
  }
  return out
}
