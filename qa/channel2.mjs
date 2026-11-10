import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  // open the honey-pot server from the rail
  await page.locator('.rail-ico').nth(2).click()   // 📡, sep is not ico; nth(1)=server? indices: 0=home,1=server,2=+
  await sleep(1200)
  await page.screenshot({ path: 'qa/shots/16-back-channel.png' })
  return { title: await page.title(), url: page.url(), snap: (await ui.snapshot()).slice(0,1500) }
}
