import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.keyboard.press('Escape'); await sleep(300)
  // clear composer draft
  const box = page.locator('textarea').last()
  await box.click(); await box.fill('')
  // open emoji picker
  await page.getByRole('button', { name: 'Emoji' }).click(); await sleep(600)
  await page.screenshot({ path: 'qa/shots/27-emoji.png' })
  const snap = await ui.snapshot()
  return { snap: snap.slice(0, 1800) }
}
