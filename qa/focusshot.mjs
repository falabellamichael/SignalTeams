import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page); await sleep(600)
  const out = {}
  out.focused = await page.locator('.vs-focus').count()
  if (!out.focused) {   // re-open: still in call, click tile
    await page.evaluate(() => document.querySelector('.vs-tile')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await sleep(800)
    out.focused = await page.locator('.vs-focus').count()
  }
  await page.screenshot({ path: 'qa/shots/72-focus-desk.png' })
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.vsf-actions button')].find(x => /screen|camera/i.test(x.title))
    b?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(700)
  await page.screenshot({ path: 'qa/shots/73-focus-desk2.png' })
  out.fname = await page.locator('.vsf-name').first().textContent().catch(() => '')
  return out
}
