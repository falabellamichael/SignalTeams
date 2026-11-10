import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const box = page.locator('textarea').last()
  await box.click()
  // clear leftover draft
  await box.fill('')
  // summon uxscribe via mention pick
  await page.keyboard.type('@uxsc', { delay: 50 })
  await sleep(600)
  await page.screenshot({ path: 'qa/shots/19-agent-mention.png' })
  await page.keyboard.press('Enter')          // pick @uxscribe
  await sleep(300)
  await page.keyboard.type('rate this UI for me', { delay: 15 })
  await page.keyboard.press('Enter')          // send
  await sleep(4000)                            // wait for typing indicator / reply
  await page.screenshot({ path: 'qa/shots/20-agent-reply.png' })
  return { snap: (await ui.snapshot({full:true})).slice(-2500) }
}
