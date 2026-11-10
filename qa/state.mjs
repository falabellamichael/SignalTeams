import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.screenshot({ path: 'qa/shots/24-state.png' })
  return { snap: (await ui.snapshot()).slice(0, 1500) }
}
