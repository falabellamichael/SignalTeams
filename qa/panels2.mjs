import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const out = {}
  // Notifications bell — may now carry a badge count in its name
  const bell = page.getByRole('button', { name: /Notifications/ }).first()
  await bell.click(); await sleep(700)
  await page.screenshot({ path: 'qa/shots/22-bell.png' })
  out.bell = (await ui.snapshot()).slice(0, 1400)
  await page.keyboard.press('Escape'); await sleep(400)
  // Search everywhere
  await page.getByRole('button', { name: /Search everywhere/ }).first().click(); await sleep(700)
  await page.screenshot({ path: 'qa/shots/23-search.png' })
  out.search = (await ui.snapshot()).slice(0, 1400)
  return out
}
