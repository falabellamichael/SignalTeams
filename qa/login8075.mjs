import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const r = await page.evaluate(() => ({
    inputs: [...document.querySelectorAll('input')].map((i) => ({ t: i.type, ph: i.placeholder })),
    btns: [...document.querySelectorAll('button')].map((b) => b.textContent.trim().slice(0, 30)),
    tabs: [...document.querySelectorAll('.prov-tabs button')].map((b) => b.textContent.trim()),
  }))
  await page.screenshot({ path: 'qa/shots/64-login8075.png' })
  return r
}
