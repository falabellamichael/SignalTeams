import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  // without reloading — check for the pending badge on the home rail icon + Friends tab
  await sleep(800)
  const badge = await page.evaluate(() =>
    [...document.querySelectorAll('.rail-badge')].map(e => e.textContent))
  await page.screenshot({ path: 'qa/shots/36-pending.png' })
  // open Friends to see the incoming request
  await page.getByText('Friends', { exact: true }).first().click().catch(() => {})
  await sleep(900)
  await page.screenshot({ path: 'qa/shots/37-pending-friends.png' })
  return { badge, snap: (await ui.snapshot()).slice(0, 900) }
}
