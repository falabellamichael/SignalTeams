import { sleep } from './lib.mjs'
export default async function run(page, ui) {
  const out = {}
  out.navs = await page.evaluate(() => [...document.querySelectorAll('.nav-item')].map(n => n.textContent.trim().slice(0, 30)))
  const dm = page.locator('.nav-item', { hasText: 'Mike' }).first()
  out.dmc = await dm.count()
  if (out.dmc) { await dm.click(); await sleep(1200) }
  out.h1 = await page.locator('.chan-head .ch-name, .chan-head').first().textContent().catch(() => '')
  out.joinBtns = await page.evaluate(() => [...document.querySelectorAll('.chan-head button, .ch-tools button')].map(b => b.title || b.textContent.trim()).slice(0, 12))
  out.anyJoin = await page.locator('button[title*="voice" i]').count()
  await page.screenshot({ path: 'qa/shots/dm.png' })
  return out
}
