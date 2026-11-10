import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  // attach a file via the hidden input
  const box = page.locator('textarea').last()
  const fi = page.locator('input[type=file]').first()
  await fi.setInputFiles('qa/shots/01-home.png')
  await sleep(1200)
  await page.screenshot({ path: 'qa/shots/42-attach.png' })
  const snap1 = await ui.snapshot()
  return { snap1: snap1.slice(-600) }
}
