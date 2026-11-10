import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  return await page.evaluate(async () => {
    try {
      const v = await import('/src/voice.js')
      return {
        keys: Object.keys(v),
        peers: typeof window.__voicePeers,
        state: typeof window.__voiceState,
        snap: v.onVoice ? (() => { let s; v.onVoice((x) => s = x)(); return s })() : null,
      }
    } catch (e) { return { err: String(e).slice(0, 200) } }
  })
}
