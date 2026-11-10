import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const out = {}
  out.patched = await page.evaluate(() => {
    const fake = (color) => {
      const c = document.createElement("canvas")
      c.width = 320; c.height = 180
      const ctx = c.getContext("2d")
      ctx.fillStyle = color; ctx.fillRect(0, 0, 320, 180)
      return c.captureStream(15)
    }
    const md = { getUserMedia: async () => fake("#28527a"), getDisplayMedia: async () => fake("#7a3b2e") }
    try { Object.defineProperty(navigator, "mediaDevices", { get: () => md, configurable: true }) } catch (e) { return "defProp fail " + e }
    return typeof navigator.mediaDevices.getDisplayMedia === "function"
  })
  const join = page.locator('button[title="Join voice"]').first()
  out.joinBtn = await join.count()
  if (out.joinBtn) { await join.click({ timeout: 6000 }).catch((e) => { out.joinErr = String(e).slice(0, 140) }) }
  await sleep(2200)
  out.joined = await page.locator('.voice-bar', { hasText: 'voice connected' }).count()
  const camBtn = page.locator('.voice-bar button[title*="camera" i]').first()
  out.camBtn = await camBtn.count()
  if (out.camBtn) { await camBtn.click(); await sleep(1300) }
  const shareBtn = page.locator('.voice-bar button[title*="screen" i], .voice-bar button[title*="Shar" i]').first()
  out.shareBtn = await shareBtn.count()
  if (out.shareBtn) { await shareBtn.click(); await sleep(1300) }
  out.tiles = await page.locator('.vs-tile').count()
  out.flip = await page.locator('.vs-flip').count()
  out.name1 = await page.locator('.vs-name').first().textContent().catch(() => '')
  await page.screenshot({ path: 'qa/shots/60-flip.png' })
  if (out.flip) {
    await page.locator('.vs-flip').first().click()
    await sleep(700)
    out.name2 = await page.locator('.vs-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/61-flipped.png' })
    await page.locator('.vs-flip').first().click()
    await sleep(500)
    out.name3 = await page.locator('.vs-name').first().textContent().catch(() => '')
  }
  return out
}
