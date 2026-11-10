import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  page.on('dialog', (d) => d.accept())
  const out = {}
  const del = page.locator('.modal button', { hasText: /^Delete$/ }).first()
  if (await del.count()) { await del.click(); await sleep(800) }
  // in-modal confirm?
  const ok = page.locator('.modal button', { hasText: /delete|confirm|yes/i }).first()
  if (await ok.count()) { await ok.click().catch(()=>{}); await sleep(900) }
  out.chanLeft = await page.locator('.nav-item', { hasText: 'qa-check' }).count()
  await page.screenshot({ path: 'qa/shots/52-clean.png' })
  return out
}
