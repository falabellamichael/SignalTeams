import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.getByRole('button', { name: '+ Add friend' }).click()
  await sleep(600)
  const snap = await ui.snapshot()
  const tb = snap.match(/@(e\d+) textbox/)?.[1]
  if (tb) { await ui.fill('@' + tb, 'mike'); await sleep(400) }
  await page.screenshot({ path: 'qa/shots/10-addfriend.png' })
  return { snap: await ui.snapshot() }
}
