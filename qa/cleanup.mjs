import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.locator('.rail-ico').nth(1).click()
  await sleep(800)
  const out = {}
  // hover qa-check row → gear button (now a real button)
  const row = page.locator('.nav-item', { hasText: 'qa-check' }).first()
  await row.hover()
  const gear = row.locator('button.ch-gear[title="Edit channel"]')
  out.gear = await gear.count()
  if (out.gear) { await gear.click(); await sleep(800) }
  await page.screenshot({ path: 'qa/shots/51-editchan.png' })
  const del = page.locator('.modal button', { hasText: /delete/i }).first()
  out.delBtn = await del.count()
  if (out.delBtn) {
    await del.click(); await sleep(600)
    // confirm dialog if present
    const ok = page.locator('.modal button', { hasText: /delete|confirm|yes/i }).first()
    if (await ok.count()) { await ok.click(); await sleep(900) }
  }
  out.chanLeft = await page.locator('.nav-item', { hasText: 'qa-check' }).count()
  await page.screenshot({ path: 'qa/shots/52-clean.png' })
  return out
}
