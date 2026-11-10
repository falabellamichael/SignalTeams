import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const out = {}
  await page.locator('.me-bar button[title="Settings"], .me-btn[title="Settings"]').first().click()
  await sleep(900)
  out.modalOpen = await page.locator('.modal').count()
  await page.screenshot({ path: 'qa/shots/49-settings.png' })
  // tab through the modal sections
  out.tabs = await page.locator('.modal .tab, .modal nav button, .modal .set-nav button').count()
  return out
}
