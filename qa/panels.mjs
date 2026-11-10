import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const out = {}
  // Inbox
  await page.getByRole('button', { name: /Inbox/ }).click(); await sleep(700)
  await page.screenshot({ path: 'qa/shots/21-inbox.png' })
  out.inbox = (await ui.snapshot()).slice(0, 1400)
  await page.keyboard.press('Escape'); await sleep(300)
  // Notifications bell
  await page.getByRole('button', { name: 'Notifications' }).click(); await sleep(700)
  await page.screenshot({ path: 'qa/shots/22-bell.png' })
  out.bell = (await ui.snapshot()).slice(0, 1400)
  await page.keyboard.press('Escape'); await sleep(300)
  // Search everywhere
  await page.getByRole('button', { name: 'Search everywhere' }).click(); await sleep(700)
  await page.screenshot({ path: 'qa/shots/23-search.png' })
  out.search = (await ui.snapshot()).slice(0, 1400)
  return out
}
