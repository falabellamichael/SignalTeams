import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  if (await page.locator('.login-card input[type="email"]').count()) {
    await page.locator('.login-card input[type="email"]').fill('FalabellaSocial@gmail.com')
    await page.locator('.login-card input[type="password"]').fill('Maitland1')
    await page.locator('.login-card button.primary').click()
    await sleep(3500)
  }
  await desk(page)
  const out = { loggedIn: await page.locator('.rail').count() }
  await page.locator('.rail .it').nth(1).click().catch(()=>{})
  await sleep(800)
  const plus = page.locator('.side-sec', { hasText: 'TEXT CHANNELS' }).locator('button, .plus').first()
  if (await plus.count()) { await plus.click(); await sleep(700) }
  out.modalOpen = await page.locator('.modal').count()
  await page.screenshot({ path: 'qa/shots/46-newchan.png' })
  if (out.modalOpen) {
    await page.locator('.modal input').first().fill('qa-check')
    await page.locator('.modal button.primary, .modal button').filter({ hasText: /create|save/i }).first().click()
    await sleep(1000)
    out.chanMade = await page.locator('.chan').filter({ hasText: 'qa-check' }).count()
    await page.screenshot({ path: 'qa/shots/46b-chan.png' })
  }
  await page.locator('.side div, .side a').filter({ hasText: /^Events$/ }).first().click().catch(()=>{})
  await sleep(700)
  await page.screenshot({ path: 'qa/shots/47-events.png' })
  return out
}
