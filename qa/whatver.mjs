import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  await page.goto('http://localhost:8075/?nc2=' + Date.now(), { waitUntil: 'load' }).catch(() => {})
  await sleep(2500)
  return await page.evaluate(async () => {
    const html = document.documentElement.outerHTML.match(/assets\/index-[^"]+\.js/)
    return {
      url: location.href,
      bundleTag: html && html[0],
      vs: typeof window.__voiceState,
      peers: typeof window.__voicePeers,
      swKeys: Object.keys(window).filter((k) => k.startsWith('__')).slice(0, 12),
    }
  })
}
