import { sleep } from './lib.mjs'
export default async function run(page, ui) {
  await page.addInitScript(() => {
    const fake = (color) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180
      const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 320, 180)
      let hue = 0
      setInterval(() => { x.fillStyle = `hsl(${hue = (hue + 4) % 360},60%,40%)`; x.fillRect(0, 0, 320, 180) }, 120)
      return c.captureStream(15)
    }
    const md = { getUserMedia: async () => fake("#28527a"),
                 getDisplayMedia: async () => fake("#7a3b2e") }
    Object.defineProperty(navigator, "mediaDevices", { get: () => md, configurable: true })
  })
  await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForSelector('.rail', { timeout: 25000 }).catch(() => {})
  await sleep(1500)
  const out = {}
  const dm = page.locator('.nav-item', { hasText: 'Mike' }).first()
  if (await dm.count()) { await dm.click({ timeout: 5000 }).catch(() => {}); await sleep(900) }
  await page.locator('button[title="Join voice"]').first().click({ timeout: 6000 }).catch(() => { out.je = 'timeout' })
  for (let i = 0; i < 12 && !(await page.locator('.voice-bar').count()); i++) await sleep(500)
  out.bar = await page.locator('.voice-bar').count()
  if (out.bar) {
    await page.locator('.voice-bar button[title*="camera" i]').first().click().catch(() => {})
    await sleep(1400)
    await page.locator('.voice-bar button[title*="screen" i]').first().click().catch(() => {})
    await sleep(1600)
    out.tiles = await page.locator('.vs-tile').count()
    out.flip = await page.locator('.vs-flip').count()
    out.vids = await page.locator('.vs-tile video').count()
    out.name1 = await page.locator('.vs-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/60-strip.png' })
    if (out.flip) {
      await page.locator('.vs-flip').first().click(); await sleep(800)
      out.name2 = await page.locator('.vs-name').first().textContent().catch(() => '')
    }
    // click to expand
    await page.locator('.vs-tile video.on').first().click().catch(() => {})
    await sleep(700)
    out.zoomed = await page.locator('.feed-zoom').count()
    out.zvids = await page.locator('.fz-stage video').count()
    out.zname = await page.locator('.fz-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/61-zoomed.png' })
    // flip inside zoom
    const zf = page.locator('.fz-actions button[title*="screen" i], .fz-actions button[title*="camera" i]').first()
    if (await zf.count()) {
      await zf.click(); await sleep(800)
      out.zname2 = await page.locator('.fz-name').first().textContent().catch(() => '')
      await page.screenshot({ path: 'qa/shots/62-zoomflip.png' })
    }
    // close via Escape, then backdrop click path next time
    await page.keyboard.press('Escape'); await sleep(500)
    out.closed = (await page.locator('.feed-zoom').count()) === 0
    // backdrop close path
    await page.locator('.vs-tile video.on').first().click().catch(() => {})
    await sleep(600)
    await page.mouse.click(40, 40); await sleep(500)
    out.closed2 = (await page.locator('.feed-zoom').count()) === 0
  }
  return out
}
