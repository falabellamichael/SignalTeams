import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  return await page.evaluate(() => ({
    vs: typeof window.__voiceState,
    peers: typeof window.__voicePeers,
    url: location.href,
  }))
}
