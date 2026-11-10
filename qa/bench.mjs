import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  // find UXScribe card's + bench button
  const card = page.locator('*').filter({ hasText: 'UXScribe' }).last()
  // simpler: all + bench buttons; UXScribe is 2nd card in the grid (index may vary) — click by proximity via xpath
  const btn = page.locator('button:has-text("+ bench")').nth(1)
  await btn.click()
  await sleep(900)
  await page.screenshot({ path: 'qa/shots/08-benched.png' })
  return { snap: (await ui.snapshot()).slice(0, 2000) }
}
