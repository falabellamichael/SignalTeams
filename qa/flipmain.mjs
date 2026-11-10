import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  // main-world device fakes, installed before app scripts
  await page.addInitScript(() => {
    const fake = (color) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180
      const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 320, 180)
      return c.captureStream(15)
    }
    const md = { getUserMedia: async () => fake("#28527a"),
                 getDisplayMedia: async () => fake("#7a3b2e") }
    Object.defineProperty(navigator, "mediaDevices", { get: () => md, configurable: true })
  })
  await page.goto('http://localhost:5175/?nc=' + Date.now(), { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForSelector('.rail', { timeout: 20000 }).catch(() => {})
  await sleep(1500)
  const out = {}
  const dm = page.locator('.nav-item', { hasText: 'Mike' }).first()
  if (await dm.count()) { await dm.click({ timeout: 5000 }).catch(() => {}); await sleep(900) }
  await page.locator('button[title="Join voice"]').first().click({ timeout: 6000 }).catch((e) => { out.je = 'timeout' })
  // voice bar may take a moment
  for (let i = 0; i < 10 && !(await page.locator('.voice-bar').count()); i++) await sleep(500)
  out.bar = await page.locator('.voice-bar').count()
  out.err = await page.locator('.send-err, .err').last().textContent().catch(() => '')
  if (out.bar) {
    await page.locator('.voice-bar button[title*="camera" i]').first().click().catch(() => {})
    await sleep(1400)
    await page.locator('.voice-bar button[title*="screen" i]').first().click().catch(() => {})
    await sleep(1600)
    out.tiles = await page.locator('.vs-tile').count()
    out.flip = await page.locator('.vs-flip').count()
    out.vids = await page.locator('.vs-tile video').count()
    out.meta = await page.evaluate(() => [...document.querySelectorAll('.vs-tile video')].map(v => ({ off: v.className, hasSrc: !!v.srcObject })))
    out.name1 = await page.locator('.vs-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/60-flip.png' })
    if (out.flip) {
      await page.locator('.vs-flip').first().click(); await sleep(900)
      out.name2 = await page.locator('.vs-name').first().textContent().catch(() => '')
      out.meta2 = await page.evaluate(() => [...document.querySelectorAll('.vs-tile video')].map(v => v.className))
      await page.screenshot({ path: 'qa/shots/61-flipped.png' })
      await page.locator('.vs-flip').first().click(); await sleep(700)
      out.name3 = await page.locator('.vs-name').first().textContent().catch(() => '')
    }
  }
  return out
}
