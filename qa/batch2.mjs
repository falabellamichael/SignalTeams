import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const box = page.locator('textarea').last()
  await box.fill('attachment test')
  await page.keyboard.press('Enter')
  await sleep(1500)
  // pin the shrug message via its meta pin button (ungrouped msgs have meta icons)
  const pinBtns = page.locator('.del-msg[title="Pin"], .del-msg[title="Unpin"]')
  const n = await pinBtns.count()
  if (n) { await pinBtns.first().click({ force: true }); await sleep(800) }
  await page.screenshot({ path: 'qa/shots/43-pinned.png' })
  // open bell panel
  await page.getByRole('button', { name: /Notifications/ }).first().click()
  await sleep(800)
  await page.screenshot({ path: 'qa/shots/44-bellpanel.png' })
  return { pinned: n }
}
