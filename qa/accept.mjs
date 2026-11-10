import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.locator('.rail-ico').first().click()   // 📡 home
  await sleep(1200)
  await page.getByText('Friends', { exact: true }).first().click()
  await sleep(900)
  await page.getByRole('button', { name: /Pending/ }).click()
  await sleep(700)
  await page.screenshot({ path: 'qa/shots/38-pending-tab.png' })
  const snap = await ui.snapshot()
  return { snap: snap.slice(0, 1200) }
}
