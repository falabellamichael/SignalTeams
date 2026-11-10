import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  // hover a message to see the trimmed bar one last time
  const msg = page.locator('.msg .text', { hasText: 'attachment test' }).first()
  await msg.hover({ timeout: 8000 }).catch(() => {})
  await sleep(400)
  await page.screenshot({ path: 'qa/shots/45-final.png' })
  return { ok: true }
}
