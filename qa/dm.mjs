import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.getByRole('button', { name: 'Message' }).first().click()
  await sleep(1200)
  await page.screenshot({ path: 'qa/shots/14-dm.png' })
  const snap = await ui.snapshot()
  // send a DM message
  const box = snap.match(/@(e\d+) textbox "Message/)?.[1]
  if (box) {
    await ui.fill('@' + box, 'hey mike — DM from falabella')
    await ui.ref('@' + box).press('Enter')
    await sleep(1200)
  }
  await page.screenshot({ path: 'qa/shots/15-dm-sent.png' })
  return { snap: await ui.snapshot() }
}
