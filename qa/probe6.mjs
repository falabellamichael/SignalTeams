import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.reload({ waitUntil: 'load' }).catch(() => {})
  await sleep(2500)
  const out = {}
  out.voiceMod = await page.evaluate(() => typeof window.__voiceState === 'function' ? window.__voiceState() : 'NO MODULE')
  await page.evaluate(() => {
    const fake = (color) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180
      c.getContext("2d").fillStyle = color; c.getContext("2d").fillRect(0, 0, 320, 180)
      return c.captureStream(15)
    }
    const md = { getUserMedia: async () => { window.__gum = (window.__gum || 0) + 1; return fake("#28527a") },
                 getDisplayMedia: async () => fake("#7a3b2e") }
    Object.defineProperty(navigator, "mediaDevices", { get: () => md, configurable: true })
  })
  const dm = page.locator('.nav-item', { hasText: 'Mike' }).first()
  if (await dm.count()) { await dm.click({ timeout: 4000 }).catch(() => {}); await sleep(700) }
  await page.locator('button[title="Join voice"]').first().click({ timeout: 5000 }).catch((e) => { out.je = 'click' })
  await sleep(2500)
  out.after = await page.evaluate(() => ({
    gum: window.__gum,
    state: window.__voiceState ? window.__voiceState() : 'gone',
    bar: !!document.querySelector('.voice-bar'),
  }))
  return out
}
