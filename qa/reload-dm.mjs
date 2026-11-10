import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await page.reload(); await sleep(1500); await desk(page)
  // open friends, find mike, open DM
  await page.getByText('Friends', { exact: true }).first().click().catch(()=>{})
  await sleep(900)
  await page.screenshot({ path: 'qa/shots/13-friends-reloaded.png' })
  return { snap: (await ui.snapshot({full:true})).slice(0,3500) }
}
