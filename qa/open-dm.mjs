import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  // reload friends state by clicking Friends again
  await page.getByText('Friends', { exact: true }).first().click().catch(()=>{})
  await sleep(900)
  await page.screenshot({ path: 'qa/shots/12-friends-after.png' })
  const snap = await ui.snapshot({full:true})
  return { snap: snap.slice(0, 3000) }
}
