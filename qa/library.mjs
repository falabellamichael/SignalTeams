import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  // open the drawer if it's mobile-hidden, else sidebar is visible already
  const lib = page.getByText('Agent Library', { exact: false }).first()
  if (!(await lib.isVisible().catch(() => false))) {
    await page.locator('.burger').click().catch(() => {})
    await sleep(400)
  }
  await lib.click({ timeout: 8000 })
  await sleep(1200)
  await page.screenshot({ path: 'qa/shots/07-library.png' })
  return { snap: await ui.snapshot() }
}
