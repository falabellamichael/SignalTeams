export default async function run(page, ui) {
  let snap = await ui.snapshot()
  const wave = snap.match(/@(e\d+) button "👋 Wave hello"/)?.[1]
  await ui.click('@' + wave)
  await page.waitForTimeout(800)

  snap = await ui.snapshot()
  const box = snap.match(/@(e\d+) textbox "Message #general"/)?.[1]
  await ui.fill('@' + box, 'hello from the new account — testing the composer')
  await page.waitForTimeout(200)

  // press Enter to send (common expectation)
  await ui.ref('@' + box).press('Enter')
  await page.waitForTimeout(1000)

  return { snap: await ui.snapshot({full:true}) }
}
