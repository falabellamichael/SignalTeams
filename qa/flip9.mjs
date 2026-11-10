import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const out = {}
  // log in on :8075 if needed (crew account tab? — Supabase email works)
  if (await page.locator('.login-card input[type="email"]').count()) {
    await page.locator('.login-card input[type="email"]').fill('FalabellaSocial@gmail.com')
    await page.locator('.login-card input[type="password"]').fill('Maitland1')
    await page.locator('.login-card button.primary').click()
    await sleep(3500)
  }
  await page.evaluate(async () => {
    const fake = (color) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180
      const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 320, 180)
      return c.captureStream(15)
    }
    const md = { getUserMedia: async () => { window.__gum = (window.__gum || 0) + 1; return fake("#28527a") },
                 getDisplayMedia: async () => { window.__gdm = (window.__gdm || 0) + 1; return fake("#7a3b2e") } }
    Object.defineProperty(navigator, "mediaDevices", { get: () => md, configurable: true })
  })
  const dm = page.locator('.nav-item', { hasText: 'Mike' }).first()
  if (await dm.count()) { await dm.click({ timeout: 5000 }).catch(() => {}); await sleep(900) }
  await page.locator('button[title="Join voice"]').first().click({ timeout: 6000 }).catch((e) => { out.je = 'click-timeout' })
  await sleep(2200)
  out.v = await page.evaluate(() => ({ gum: window.__gum, st: window.__voiceState?.() }))
  out.bar = await page.locator('.voice-bar').count()
  if (out.bar) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('.voice-bar button')].find((x) => /camera/i.test(x.title)); b?.click() })
    await sleep(1300)
    await page.evaluate(() => { const b = [...document.querySelectorAll('.voice-bar button')].find((x) => /screen|shar/i.test(x.title)); b?.click() })
    await sleep(1400)
    out.st = await page.evaluate(() => window.__voiceState?.())
    out.tiles = await page.locator('.vs-tile').count()
    out.flip = await page.locator('.vs-flip').count()
    out.name1 = await page.locator('.vs-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/60-flip.png' })
    if (out.flip) {
      await page.locator('.vs-flip').first().click(); await sleep(800)
      out.name2 = await page.locator('.vs-name').first().textContent().catch(() => '')
      await page.screenshot({ path: 'qa/shots/61-flipped.png' })
      await page.locator('.vs-flip').first().click(); await sleep(600)
      out.name3 = await page.locator('.vs-name').first().textContent().catch(() => '')
    }
  }
  return out
}
