import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const box = page.locator('textarea').last()
  await box.click(); await box.fill('')
  await page.keyboard.type('/shrug', { delay: 30 })
  await sleep(400)
  await page.keyboard.press('Enter')   // single Enter should send now
  await sleep(1200)
  await page.screenshot({ path: 'qa/shots/34-shrug.png' })
  const tail = await page.evaluate(() =>
    [...document.querySelectorAll('.msg .text')].slice(-2).map(e => e.textContent))
  return { tail }
}
