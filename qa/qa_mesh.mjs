export default async function run(page, ui) {
  const ref = (s, re) => { const m = s.match(re); return m ? '@' + m[1] : null }
  let s = await ui.snapshot()
  const crew = ref(s, /@(e\d+) button "crew account"/i)
  if (crew) { await ui.click(crew); await page.waitForTimeout(600); s = await ui.snapshot() }
  const boxes = [...s.matchAll(/@(e\d+) textbox/g)].map(m => '@' + m[1])
  await ui.fill(boxes[0], 'mike'); await ui.fill(boxes[boxes.length - 1], 'password')
  s = await ui.snapshot()
  const go = ref(s, /@(e\d+) button "(log ?in|sign ?in|enter hive|continue|join)"/i)
  await ui.click(go)
  await page.waitForTimeout(4000)
  s = await ui.snapshot()
  const gear = ref(s, /@(e\d+) button "Settings"/i)
  if (!gear) return { fail: 'no settings btn', s: s.slice(0, 2500) }
  await ui.click(gear); await page.waitForTimeout(800)
  s = await ui.snapshot()
  const mesh = ref(s, /@(e\d+) button "Nexus Mesh"/i)
  if (!mesh) return { fail: 'no mesh rail', s: s.slice(0, 2500) }
  await ui.click(mesh); await page.waitForTimeout(2500)
  return { tree: (await ui.snapshot({ full: true })).slice(0, 5000) }
}
