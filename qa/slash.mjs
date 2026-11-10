import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const box = page.locator('textarea, [contenteditable]').last()
  // slash command palette: type "/" and see what pops
  await box.click()
  await page.keyboard.type('/', { delay: 40 })
  await sleep(500)
  await page.screenshot({ path: 'qa/shots/17-slash-palette.png' })
  const snap1 = await ui.snapshot()
  // finish /roll and send
  await page.keyboard.type('roll 2d6', { delay: 20 })
  await sleep(400)
  await page.keyboard.press('Enter')
  await sleep(1000)
  // /shrug
  await page.keyboard.type('/shrug', { delay: 20 })
  await sleep(400)
  await page.keyboard.press('Enter')
  await sleep(800)
  // mention autocomplete — type @
  await page.keyboard.type('@', { delay: 40 })
  await sleep(600)
  await page.screenshot({ path: 'qa/shots/18-mention-pop.png' })
  const snap2 = await ui.snapshot()
  await page.keyboard.press('Escape')
  return { snap1: snap1.slice(0, 1600), snap2: snap2.slice(0, 1600) }
}
