import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const out = {}
  // ensure voice module is live + devices faked
  await page.evaluate(async () => {
    await import('/src/voice.js')
    const fake = (color) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180
      const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 320, 180)
      return c.captureStream(15)
    }
    const md = { getUserMedia: async () => { window.__gum = (window.__gum || 0) + 1; return fake("#28527a") },
                 getDisplayMedia: async () => { window.__gdm = (window.__gdm || 0) + 1; return fake("#7a3b2e") } }
    Object.defineProperty(navigator, "mediaDevices", { get: () => md, configurable: true })
  })
  // open Mike DM
  const dm = page.locator('.nav-item', { hasText: 'Mike' }).first()
  if (await dm.count()) { await dm.click({ timeout: 5000 }).catch(() => {}); await sleep(800) }
  await page.locator('button[title="Join voice"]').first().click({ timeout: 6000 }).catch((e) => { out.je = String(e).slice(0, 120) })
  await sleep(2200)
  out.v = await page.evaluate(() => window.__voiceState ? window.__voiceState() : null)
  out.bar = await page.locator('.voice-bar').count()
  const camBtn = page.locator('.voice-bar button[title*="camera" i]').first()
  if (await camBtn.count()) { await camBtn.click(); await sleep(1300) }
  const shareBtn = page.locator('.voice-bar button[title*="screen" i]').first()
  if (await shareBtn.count()) { await shareBtn.click(); await sleep(1300) }
  out.tiles = await page.locator('.vs-tile').count()
  out.flip = await page.locator('.vs-flip').count()
  out.name1 = await page.locator('.vs-name').first().textContent().catch(() => '')
  await page.screenshot({ path: 'qa/shots/60-flip.png' })
  if (out.flip) {
    await page.locator('.vs-flip').first().click(); await sleep(700)
    out.name2 = await page.locator('.vs-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/61-flipped.png' })
    await page.locator('.vs-flip').first().click(); await sleep(500)
    out.name3 = await page.locator('.vs-name').first().textContent().catch(() => '')
  }
  return out
}
