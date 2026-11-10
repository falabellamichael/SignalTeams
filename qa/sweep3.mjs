import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const out = {}
  await page.locator('.rail-ico').nth(1).click()
  await sleep(900)
  // "+ Add text channel" button should now be a real button
  const addBtn = page.locator('.side-group', { hasText: 'Text channels' }).locator('button.add')
  out.addBtn = await addBtn.count()
  if (out.addBtn) { await addBtn.click(); await sleep(700) }
  out.modalOpen = await page.locator('.modal').count()
  await page.screenshot({ path: 'qa/shots/46-newchan.png' })
  if (out.modalOpen) {
    const nameIn = page.locator('.modal input').first()
    await nameIn.fill('qa-check')
    await page.locator('.modal button.primary').first().click()
    await sleep(1100)
    out.chanMade = await page.locator('.nav-item .txt').filter({ hasText: 'qa-check' }).count()
    await page.screenshot({ path: 'qa/shots/46b-chan.png' })
  }
  // Events
  const ev = page.locator('.nav-item', { hasText: 'Events' }).first()
  if (await ev.count()) { await ev.click(); await sleep(900) }
  await page.screenshot({ path: 'qa/shots/47-events.png' })
  await page.keyboard.press('Escape').catch(()=>{})
  return out
}
