import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.getByRole('button', { name: 'Send request' }).click()
  await sleep(900)
  await page.screenshot({ path: 'qa/shots/11-req-sent.png' })
  return { snap: await ui.snapshot() }
}
