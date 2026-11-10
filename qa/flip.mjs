import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  if (await page.locator('.login-card input[type="email"]').count()) {
    await page.locator('.login-card input[type="email"]').fill('FalabellaSocial@gmail.com')
    await page.locator('.login-card input[type="password"]').fill('Maitland1')
    await page.locator('.login-card button.primary').click()
    await sleep(3500)
  }
  await desk(page)
  const out = {}
  await page.evaluate(() => {
    const fake = (color) => {
      const c = document.createElement("canvas")
      c.width = 320; c.height = 180
      const ctx = c.getContext("2d")
      ctx.fillStyle = color; ctx.fillRect(0, 0, 320, 180)
      return c.captureStream(15)
    }
    navigator.mediaDevices = navigator.mediaDevices || {}
    navigator.mediaDevices.getUserMedia = async () => fake("#28527a")
    navigator.mediaDevices.getDisplayMedia = async () => fake("#7a3b2e")
  })
  await page.locator('.nav-item', { hasText: 'Mike' }).first().click()
  await sleep(900)
  const join = page.locator('button[title="Join voice"]').first()
  out.joinBtn = await join.count()
  if (out.joinBtn) { await join.click(); await sleep(1800) }
  out.joined = await page.locator('.voice-bar', { hasText: 'voice connected' }).count()
  const camBtn = page.locator('.voice-bar button[title*="camera" i]').first()
  out.camBtn = await camBtn.count()
  if (out.camBtn) { await camBtn.click(); await sleep(1200) }
  const shareBtn = page.locator('.voice-bar button[title*="screen" i], .voice-bar button[title*="Shar" i]').first()
  out.shareBtn = await shareBtn.count()
  if (out.shareBtn) { await shareBtn.click(); await sleep(1200) }
  out.tiles = await page.locator('.vs-tile').count()
  out.flip = await page.locator('.vs-flip').count()
  out.name1 = await page.locator('.vs-name').first().textContent().catch(() => '')
  await page.screenshot({ path: 'qa/shots/60-flip.png' })
  if (out.flip) {
    await page.locator('.vs-flip').first().click()
    await sleep(700)
    out.name2 = await page.locator('.vs-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/61-flipped.png' })
    // flip back
    await page.locator('.vs-flip').first().click()
    await sleep(500)
    out.name3 = await page.locator('.vs-name').first().textContent().catch(() => '')
  }
  return out
}
