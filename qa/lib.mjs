// shared helpers: desktop viewport + shortcuts
export async function desk(page, w = 1366, h = 800) {
  if ((await page.evaluate(() => innerWidth)) < 1000)
    await page.setViewportSize({ width: w, height: h })
}
export const sleep = (ms) => new Promise(r => setTimeout(r, ms))
