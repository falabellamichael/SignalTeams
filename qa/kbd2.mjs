import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.locator('.rail-ico').first().click()
  await sleep(800)
  const grpBtns = await page.locator('.side-group button.ch-mute').count()
  const muteBtns = await page.locator('.nav-item button.ch-mute').count()
  await page.screenshot({ path: 'qa/shots/50-home.png' })
  return { grpBtns, muteBtns }
}
