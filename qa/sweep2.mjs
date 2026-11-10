import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const out = {}
  // server icon = second rail-ico (home is first)
  await page.locator('.rail-ico').nth(1).click()
  await sleep(900)
  await page.screenshot({ path: 'qa/shots/48-server.png' })
  // + button next to TEXT CHANNELS
  const plus = page.locator('.side-sec', { hasText: 'TEXT CHANNELS' }).locator('button, .plus, svg').last()
  out.plusCount = await plus.count()
  if (out.plusCount) { await plus.click(); await sleep(700) }
  out.modalOpen = await page.locator('.modal').count()
  await page.screenshot({ path: 'qa/shots/46-newchan.png' })
  if (out.modalOpen) {
    await page.locator('.modal input').first().fill('qa-check')
    await page.locator('.modal button.primary').first().click()
    await sleep(1000)
    out.chanMade = await page.locator('.chan').filter({ hasText: 'qa-check' }).count()
    await page.screenshot({ path: 'qa/shots/46b-chan.png' })
  }
  // Events
  const ev = page.locator('.side div, .side a').filter({ hasText: /^Events$/ }).first()
  if (await ev.count()) { await ev.click(); await sleep(800) }
  await page.screenshot({ path: 'qa/shots/47-events.png' })
  out.wsock = await page.evaluate(() => window.__wsReady ?? 'n/a')
  return out
}
