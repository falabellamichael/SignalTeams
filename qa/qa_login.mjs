export default async function run(page, ui) {
  const snap = await ui.snapshot()
  const crew = snap.match(/@(e\d+) (?:tab|button)[^\n]*crew/i)?.[1]
  if (crew) { await ui.click(crew); await page.waitForTimeout(300) }
  const snap2 = await ui.snapshot()
  const boxes = [...snap2.matchAll(/@(e\d+) textbox/g)].map(m => m[1])
  const btnRef = snap2.match(/@(e\d+) button[^\n]*(?:sign in|log ?in|continue)/i)?.[1]
  if (boxes.length < 2) return { fail: 'need 2 textboxes', snap: snap2.slice(0, 1500) }
  await ui.fill(boxes[0], 'mike')
  await ui.fill(boxes[boxes.length > 2 ? boxes.length - 1 : 1], 'password')
  if (btnRef) await ui.click(btnRef)
  else await page.keyboard.press('Enter')
  await page.waitForTimeout(5000)
  const bodyLen = await page.evaluate(() => document.body.innerText.length)
  const text = await page.evaluate(() => document.body.innerText.slice(0, 400))
  return { bodyLen, text }
}
