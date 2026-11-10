import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.goto('http://localhost:5175', { waitUntil: 'networkidle' }).catch(() => {})
  await sleep(2000)
  return await page.evaluate(() => ({
    peers: typeof window.__voicePeers,
    state: typeof window.__voiceState,
    scripts: [...document.querySelectorAll('script')].map((s) => s.src).filter(Boolean).slice(0, 6),
  }))
}
