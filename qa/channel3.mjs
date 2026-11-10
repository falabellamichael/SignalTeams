import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.keyboard.press('Escape')
  await sleep(400)
  await page.locator('.rail-ico').nth(1).click()
  await sleep(1200)
  await page.screenshot({ path: 'qa/shots/16-back-channel.png' })
  return { snap: (await ui.snapshot()).slice(0,1200) }
}
