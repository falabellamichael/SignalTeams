import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.getByRole('button', { name: /Search everywhere/ }).first().click(); await sleep(800)
  await page.screenshot({ path: 'qa/shots/25-search.png' })
  const snap1 = await ui.snapshot()
  // type a query
  const tb = snap1.match(/@(e\d+) textbox/)?.[1]
  if (tb) { await ui.fill('@' + tb, 'uxscribe'); await sleep(900) }
  await page.screenshot({ path: 'qa/shots/26-search-q.png' })
  return { snap: (await ui.snapshot()).slice(0, 1600) }
}
