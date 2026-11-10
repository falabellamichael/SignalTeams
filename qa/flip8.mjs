import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  const out = {}
  out.join = await page.evaluate(async () => {
    const v = await import('/src/voice.js')
    const fake = (color) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180
      const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 320, 180)
      return c.captureStream(15)
    }
    const md = { getUserMedia: async () => fake("#28527a"), getDisplayMedia: async () => fake("#7a3b2e") }
    Object.defineProperty(navigator, "mediaDevices", { get: () => md, configurable: true })
    const tok = localStorage.getItem('signalteams.token')
    const h = { Authorization: 'Bearer ' + tok }
    const dms = await fetch('/api/dms', { headers: h }).then(r => r.json())
    const me = await fetch('/api/me', { headers: h }).then(r => r.json()).catch(() => null)
    const dm = dms.find((d) => d.other?.username === 'mike') || dms[0]
    if (!dm) return { err: 'no dm', dms }
    try {
      await v.joinVoice(dm.id, me)
      let s; v.onVoice((x) => s = x)()
      return { ok: true, dm: dm.id, joined: s.joined, cid: s.channelId }
    } catch (e) { return { err: String(e), stack: (e.stack || '').slice(0, 300) } }
  })
  await sleep(1500)
  out.bar = await page.locator('.voice-bar').count()
  if (out.bar) {
    await page.evaluate(() => { const b = [...document.querySelectorAll('.voice-bar button')].find((x) => /camera/i.test(x.title)); b?.click() })
    await sleep(1200)
    await page.evaluate(() => { const b = [...document.querySelectorAll('.voice-bar button')].find((x) => /screen|shar/i.test(x.title)); b?.click() })
    await sleep(1400)
    out.st = await page.evaluate(() => window.__voiceState?.())
    out.tiles = await page.locator('.vs-tile').count()
    out.flip = await page.locator('.vs-flip').count()
    out.name1 = await page.locator('.vs-name').first().textContent().catch(() => '')
    await page.screenshot({ path: 'qa/shots/60-flip.png' })
    if (out.flip) {
      await page.locator('.vs-flip').first().click(); await sleep(700)
      out.name2 = await page.locator('.vs-name').first().textContent().catch(() => '')
      await page.screenshot({ path: 'qa/shots/61-flipped.png' })
      await page.locator('.vs-flip').first().click(); await sleep(500)
      out.name3 = await page.locator('.vs-name').first().textContent().catch(() => '')
    }
  }
  return out
}
