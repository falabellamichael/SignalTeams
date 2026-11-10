import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.evaluate(() => {
    const fake = (color) => {
      const c = document.createElement("canvas")
      c.width = 320; c.height = 180
      const ctx = c.getContext("2d")
      ctx.fillStyle = color; ctx.fillRect(0, 0, 320, 180)
      return c.captureStream(15)
    }
    const md = { getUserMedia: async (c) => { window.__gumCalled = JSON.stringify(c); return fake("#28527a") },
                 getDisplayMedia: async () => fake("#7a3b2e") }
    Object.defineProperty(navigator, "mediaDevices", { get: () => md, configurable: true })
  })
  await page.locator('button[title="Join voice"]').first().click().catch(() => {})
  await sleep(2500)
  return { gum: await page.evaluate(() => window.__gumCalled), bar: await page.locator('.voice-bar').count() }
}
