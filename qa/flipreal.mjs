import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const out = {}
  // inject fake devices into the MAIN world before app scripts run
  await page.addInitScript(() => {
    const fake = (color) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180
      const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 320, 180)
      return c.captureStream(15)
    }
    const md = { getUserMedia: async () => { window.__gum = (window.__gum || 0) + 1; return fake("#28527a") },
                 getDisplayMedia: async () => { window.__gdm = (window.__gdm || 0) + 1; return fake("#7a3b2e") } }
    Object.defineProperty(navigator, "mediaDevices", { get: () => md, configurable: true })
  })
  await page.goto('http://localhost:5175/?nc=' + Date.now(), { waitUntil: 'load' }).catch(() => {})
  await page.waitForSelector('.login-card, .rail', { timeout: 15000 }).catch(() => {})
  if (await page.locator('.login-card input[type="email"]').count()) {
    await page.locator('.login-card input[type="email"]').fill('FalabellaSocial@gmail.com')
    await page.locator('.login-card input[type="password"]').fill('Maitland1')
    await page.locator('.login-card button.primary').click()
    await page.waitForSelector('.rail', { timeout: 15000 }).catch(() => {})
    await sleep(1000)
  }
  const dm = page.locator('.nav-item', { hasText: 'Mike' }).first()
  if (await dm.count()) { await dm.click({ timeout: 5000 }).catch(() => {}); await sleep(900) }
  await page.locator('button[title="Join voice"]').first().click({ timeout: 6000 }).catch((e) => { out.je = 'timeout' })
  await sleep(2500)
  out.v = await page.evaluate(() => ({ gum: window.__gum, gdm: window.__gdm, st: window.__voiceState?.() }))
  out.bar = await page.locator('.voice-bar').count()
  if (out.bar) {
    await page.locator('.voice-bar button[title*="camera" i]').first().click().catch(() => {})
    await sleep(1400)
    await page.locator('.voice-bar button[title*="screen" i]').first().click().catch(() => {})
    await sleep(1500)
    out.st = await page.evaluate(() => window.__voiceState?.())
    out.tiles = await page.locator('.vs-tile').count()
    out.flip = await page.locator('.vs-flip').count()
    out.vids = await page.locator('.vs-tile video').count()
    out.name1 = await page.locator('.vs-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/60-flip.png' })
    if (out.flip) {
      await page.locator('.vs-flip').first().click(); await sleep(800)
      out.name2 = await page.locator('.vs-name').first().textContent().catch(() => '')
      out.off = await page.locator('.vs-tile video.off').count()
      await page.screenshot({ path: 'qa/shots/61-flipped.png' })
      await page.locator('.vs-flip').first().click(); await sleep(600)
      out.name3 = await page.locator('.vs-name').first().textContent().catch(() => '')
    }
  }
  return out
}
