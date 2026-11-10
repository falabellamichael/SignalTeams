import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(2000); await desk(page)
  await page.locator('.rail-ico').nth(1).click()
  await sleep(1400)
  await page.screenshot({ path: 'qa/shots/41-final-channel.png' })
  return { url: page.url() }
}
