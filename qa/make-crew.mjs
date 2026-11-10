export default async function run(page, ui) {
  let snap = await ui.snapshot()
  const name = snap.match(/@(e\d+) textbox "The Crew"/)?.[1]
  await ui.fill('@' + name, 'Falabella HQ')
  await page.waitForTimeout(300)
  snap = await ui.snapshot()
  const create = [...snap.matchAll(/@(e\d+) button "Create"(?! \[)/g)].map(m=>m[1])
  // pick the last Create button (footer submit), the first is the tab
  const btn = create[create.length-1]
  const disabled = snap.includes('button "Create" [disabled]')
  await ui.click('@' + btn)
  await page.waitForTimeout(1500)
  return { disabled, url: page.url(), snap: await ui.snapshot() }
}
