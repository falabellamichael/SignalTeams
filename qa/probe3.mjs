import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
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
    const md = { getUserMedia: async (c) => { window.__gumCalled = c; return fake("#28527a") },
                 getDisplayMedia: async () => fake("#7a3b2e") }
    Object.defineProperty(navigator, "mediaDevices", { get: () => md, configurable: true })
  })
  await page.locator('button[title="Join voice"]').first().click().catch(() => {})
  await sleep(2500)
  out.err = await page.evaluate(() => ({
    gum: window.__gumCalled,
    sendErr: document.querySelector('.send-err, .err, [class*="err"]')?.textContent || null,
    voiceBar: !!document.querySelector('.voice-bar'),
    barTxt: document.querySelector('.voice-bar')?.textContent?.slice(0, 80) || null,
  }))
  return out
}
