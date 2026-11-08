// walkthrough.mjs — records a guided tour of SignalTeams for sharing.
// Launches patchright with recordVideo, drives the app scene by scene,
// and burns an in-page caption bar into the footage (no post-sync needed).
import { createRequire } from 'node:module'
import { readdirSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const byVersion = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
const EDITOR_EXTENSION_DIRS = ['.vscode', '.vscode-insiders', '.cursor', '.windsurf']
  .flatMap((d) => [join(homedir(), d, 'extensions')])

function candidateRoots() {
  const roots = []
  const add = (dir) => { if (dir && !roots.includes(dir)) roots.push(dir) }
  add(process.env.CODEGPT_RUNTIME_MODULES)
  const home = process.env.CODEGPT_HOME || join(homedir(), '.codegpt')
  try { add(JSON.parse(readFileSync(join(home, 'runtime.json'), 'utf8'))?.modulesRoot) } catch {}
  add(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'))
  for (const base of EDITOR_EXTENSION_DIRS) {
    if (!existsSync(base)) continue
    const newest = readdirSync(base).filter((d) => d.startsWith('danielsanmedium.dscodegpt-')).sort(byVersion).pop()
    if (newest) add(join(base, newest, 'standalone'))
  }
  return roots
}

let chromium
for (const root of candidateRoots()) {
  try {
    const mod = createRequire(root + (root.endsWith('/') || root.endsWith('\\') ? '' : '/'))('patchright')
    chromium = mod?.chromium ?? mod?.default?.chromium
    if (chromium) break
  } catch {}
}
if (!chromium) throw new Error('patchright not found')

const RAW = 'qa/video-raw'
mkdirSync(RAW, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
    '--disable-features=LocalNetworkAccessChecks',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const ctx = await browser.newContext({
  locale: 'en-US',
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: RAW, size: { width: 1280, height: 720 } },
})
const page = await ctx.newPage()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- helpers ---------------------------------------------------------------

// caption bar burned into the video — theme-aware via CSS vars
async function cap(text) {
  await page.evaluate((t) => {
    let el = document.getElementById('__cap')
    if (!t) { el?.remove(); return }
    if (!el) {
      el = document.createElement('div')
      el.id = '__cap'
      el.style.cssText = `position:fixed;left:50%;bottom:18px;transform:translateX(-50%);
        z-index:2147483000;max-width:76%;padding:9px 18px;border-radius:11px;
        background:rgba(13,17,23,.92);border:1px solid rgba(212,175,55,.45);
        color:#e8ebf0;font:600 15px/1.35 -apple-system,Segoe UI,sans-serif;
        text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.5);
        transition:opacity .25s;opacity:0;pointer-events:none;`
      document.body.appendChild(el)
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1' }))
    }
    el.style.opacity = '1'
    el.textContent = t
  }, text)
}

// full-screen title/end card, styled like the app
async function card(title, sub, holdMs) {
  await page.evaluate(([t, s]) => {
    document.getElementById('__cap')?.remove()
    const el = document.createElement('div')
    el.id = '__card'
    el.style.cssText = `position:fixed;inset:0;z-index:2147483100;
      display:grid;place-items:center;background:#0d1117;
      transition:opacity .5s;opacity:0;`
    el.innerHTML = `<div style="text-align:center">
      <img src="/icon-192.png" style="width:96px;height:96px;border-radius:24px;
        box-shadow:0 8px 40px rgba(212,175,55,.35)" />
      <div style="margin-top:20px;font:800 34px -apple-system,Segoe UI,sans-serif;
        color:#e8ebf0;letter-spacing:.5px">${t}</div>
      <div style="margin-top:8px;font:500 16px -apple-system,Segoe UI,sans-serif;
        color:#8b94a3">${s}</div></div>`
    document.body.appendChild(el)
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1' }))
  }, [title, sub])
  await wait(holdMs)
  await page.evaluate(() => {
    const el = document.getElementById('__card')
    if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 550) }
  })
  await wait(600)
}

async function clickText(sel, re) {
  await page.evaluate(([s, src]) => {
    const rx = new RegExp(src, 'i')
    const el = [...document.querySelectorAll(s)].find((e) => rx.test(e.textContent))
    el?.click()
  }, [sel, re.source])
  await wait(300)
}

async function typeSlow(sel, text, per = 55) {
  await page.click(sel)
  for (const ch of text) { await page.keyboard.type(ch); await wait(per) }
}

// ---- the walkthrough --------------------------------------------------------

await page.goto('http://127.0.0.1:8075', { waitUntil: 'domcontentloaded' })
await wait(2500)

await card('SignalTeams', 'a quick tour — chat, voice, and your own AI agents', 3200)

// 1 · sign in
await cap('Sign in with your crew account')
for (const t of await page.$$('button')) {
  if (((await t.evaluate(e => e.textContent)) || '').toLowerCase().includes('crew')) { await t.click(); break }
}
await page.waitForSelector('input', { timeout: 8000 })
const inputs = await page.$$('input')
await inputs[0].click(); for (const ch of 'mike') { await page.keyboard.type(ch); await wait(70) }
await inputs[1].click(); for (const ch of 'password') { await page.keyboard.type(ch); await wait(70) }
await wait(600)
for (const b of await page.$$('button')) {
  const t = ((await b.evaluate(e => e.textContent)) || '').toLowerCase()
  if (t.includes('sign') || t.includes('log') || t.includes('continue')) { await b.click(); break }
}
await page.waitForSelector('.rail', { timeout: 15000 })
await wait(2500)

// 2 · feed lands
await cap('Home is your feed — buzz and drops from across the app')
await wait(3200)

// 3 · open the server
await cap('Servers are crews — channels down the left')
await page.evaluate(() => {
  const icons = [...document.querySelectorAll('.rail-ico')]
  ;(icons.find(e => !(e.getAttribute('title') || '').startsWith('Home') && (e.getAttribute('title') || '')) || icons[1])?.click()
})
await wait(2000)

// 4 · pick a channel
await cap('Pick a channel — this is normal chat')
await clickText('.nav-item', /^#?\s*general\s*$/)
await wait(2500)

// 5 · send a message
await cap('Type a message, hit enter — it lands instantly')
await typeSlow('.composer textarea', 'giving a friend the tour — say hi!', 50)
await wait(500)
await page.keyboard.press('Enter')
await wait(2200)

// 6 · react — quick-reaction bar appears on hover
await cap('React on any message — enough stars push it to the Starboard')
await page.evaluate(() => {
  const msgs = [...document.querySelectorAll('.msg')].filter(m => m.offsetParent)
  msgs[msgs.length - 1]?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
})
await wait(900)
await page.evaluate(() => {
  const msgs = [...document.querySelectorAll('.msg')].filter(m => m.offsetParent)
  const bar = msgs[msgs.length - 1]?.querySelector('.react-bar button')
  bar?.click()
})
await wait(2500)

// 7 · member list + popout
await cap('The member list shows who’s around — click any name')
await wait(1500)
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.mrow')].find(r => !/mike/i.test(r.textContent))
  row?.click()
})
await wait(2200)
await cap('A popout: mutual servers, mutual friends, quick actions')
await wait(3600)
await page.keyboard.press('Escape')
await wait(500)
await page.evaluate(() => document.querySelector('.menu-scrim')?.click())
await wait(800)
await page.evaluate(() => document.querySelector('.menu-scrim')?.remove())
await wait(400)

// 8 · summon an agent — keyboard-pick the mention pop like a real user
await cap('@-summon an agent mid-chat — it reads the room and replies')
await typeSlow('.composer textarea', '@git', 110)
await wait(1100)
const hasPop = await page.evaluate(() => !!document.querySelector('.mention-pop .mopt'))
if (hasPop) {
  await page.keyboard.press('Enter')          // picks the highlighted match
  await wait(600)
} else {
  await page.keyboard.type('guru ', { delay: 60 })
}
await page.keyboard.type('what can you do?', { delay: 45 })
await wait(400)
await page.keyboard.press('Enter')
await wait(5000)

// 9 · voice
await cap('Voice channels are drop-in — camera and screen share built in')
await clickText('.nav-item', /Voice Lounge/i)
await wait(3500)
await cap('You can leave anytime — the room stays open for everyone else')
await wait(2200)
await page.evaluate(() => {
  (document.querySelector('.vb-leave') ||
    document.querySelector('.dock-btn.disconnect') ||
    [...document.querySelectorAll('button')]
      .find(e => /leave voice|disconnect|hang up/i.test(e.getAttribute('title') || '')))?.click()
})
await wait(1500)

// 10 · server settings
await cap('Server settings — organized pages, icon rail, everything in reach')
await page.evaluate(() =>
  [...document.querySelectorAll('.srv-gear')]
    .find(b => (b.getAttribute('title') || '').includes('Server settings'))?.click())
await wait(1500)
for (const lbl of ['Members', 'Engine', 'Audit log']) {
  await page.evaluate((l) => {
    [...document.querySelectorAll('.set-rail button')]
      .find(b => b.getAttribute('title') === l)?.click()
  }, lbl)
  await wait(1800)
}
await page.keyboard.press('Escape')
await wait(1200)

// 11 · user settings + theme swap
await cap('Your settings — four themes, notifications, AI providers')
await page.evaluate(() =>
  [...document.querySelectorAll('.me-bar .me-btn')]
    .find(b => (b.getAttribute('title') || '') === 'Settings')?.click())
await wait(1500)
await page.evaluate(() => {
  [...document.querySelectorAll('.seg button')]
    .find(b => /Warm Theme/i.test(b.textContent))?.click()
})
await wait(2200)
await page.evaluate(() => {
  [...document.querySelectorAll('.seg button')]
    .find(b => /Tokyo Night/i.test(b.textContent))?.click()
})
await wait(1500)
await page.keyboard.press('Escape')
await wait(1200)

// 12 · workspace
await cap('Workspaces — shared folders your agents can actually edit')
await page.evaluate(() => {
  const ws = [...document.querySelectorAll('.nav-item.ws-nav, .ws-nav')]
    .find(e => /AgentHive Core/i.test(e.textContent))
  ws?.click()
})
await wait(3000)

await cap('')
await card('That’s SignalTeams', 'invite code: signal-demo — see you inside', 3400)
await wait(400)

const videoPath = await page.video().path()
await ctx.close()
await browser.close()
console.log('VIDEO', videoPath)
