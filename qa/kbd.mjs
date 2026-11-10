import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.keyboard.press('Escape').catch(()=>{})
  await page.locator('.rail-ico').nth(1).click().catch(()=>{})
  await sleep(700)
  // focus the Add-text-channel button via keyboard and read its a11y name
  const btn = page.locator('.side-group', { hasText: 'Text channels' }).locator('button.add')
  await btn.focus()
  const name = await btn.getAttribute('title')
  const tag = await btn.evaluate((el) => el.tagName)
  // mark-all-read + new-group-dm buttons exist as buttons
  const grpBtns = await page.locator('.side-group button.ch-mute').count()
  return { tag, name, grpBtns }
}
