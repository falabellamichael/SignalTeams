import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.keyboard.press('Escape'); await sleep(300)
  const box = page.locator('textarea').last()
  await box.click(); await box.fill('**bold** _ital_ `code`')
  await page.getByRole('button', { name: 'Preview markdown' }).click(); await sleep(600)
  await page.screenshot({ path: 'qa/shots/28-mdpreview.png' })
  await page.getByRole('button', { name: 'Preview markdown' }).click(); await sleep(400)
  await box.fill('')
  // Settings
  await page.getByRole('button', { name: 'Settings' }).click(); await sleep(800)
  await page.screenshot({ path: 'qa/shots/29-settings.png' })
  return { snap: (await ui.snapshot()).slice(0, 1600) }
}
