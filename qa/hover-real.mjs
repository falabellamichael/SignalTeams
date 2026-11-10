import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const msg = page.locator('.msg .text', { hasText: 'hello from the new account' })
  // this timed out pre-fix; should succeed now
  await msg.hover({ timeout: 8000 })
  await sleep(400)
  await page.screenshot({ path: 'qa/shots/35-hoverbar.png' })
  // click the middle of the message text — should NOT toggle a reaction
  const before = await page.evaluate(() =>
    [...document.querySelectorAll('.rchip')].map(e => e.textContent))
  await msg.click({ timeout: 8000 })
  await sleep(500)
  const after = await page.evaluate(() =>
    [...document.querySelectorAll('.rchip')].map(e => e.textContent))
  return { before, after }
}
