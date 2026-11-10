import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.getByRole('button', { name: 'Accept' }).click()
  await sleep(1200)
  await page.screenshot({ path: 'qa/shots/39-accepted.png' })
  const snap = await ui.snapshot()
  return { snap: snap.slice(0, 1000) }
}
