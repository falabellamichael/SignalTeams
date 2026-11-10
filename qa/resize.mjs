export default async function run(page, ui) {
  await page.setViewportSize({ width: 1366, height: 800 })
  await page.waitForTimeout(600)
  return { iw: await page.evaluate(() => innerWidth) }
}
