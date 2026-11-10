import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.getByText('Reply', { exact: true }).click()
  await sleep(500)
  await page.screenshot({ path: 'qa/shots/32-reply-state.png' })
  const box = page.locator('textarea').last()
  await box.fill('replying to myself — test')
  await page.keyboard.press('Enter')
  await sleep(1200)
  await page.screenshot({ path: 'qa/shots/33-reply-sent.png' })
  return { snap: (await ui.snapshot({full:true})).slice(-1800) }
}
