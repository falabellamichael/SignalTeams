export default async function run(page, ui) {
  const item = page.getByText('Agent Library', { exact: false }).first()
  await item.click({ timeout: 8000 })
  await page.waitForTimeout(1000)
  return { snap: await ui.snapshot({full:true}) }
}
