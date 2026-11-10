import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const resp = page.waitForResponse(r => r.url().includes('/api/friends'), { timeout: 8000 }).catch(() => null)
  await page.getByRole('button', { name: 'Accept' }).click()
  const r = await resp
  await sleep(1500)
  await page.screenshot({ path: 'qa/shots/40-accepted2.png' })
  return { status: r ? r.status() : 'no request fired', snap: (await ui.snapshot()).slice(0, 900) }
}
