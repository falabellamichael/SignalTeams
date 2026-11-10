export default async function run(page, ui) {
  const snap = await ui.snapshot()
  const go = [...snap.matchAll(/@(e\d+) button "go"/g)].map(m => m[1])
  await ui.click('@' + go[0])
  await page.waitForTimeout(800)
  return { snap: await ui.snapshot(), url: page.url() }
}
