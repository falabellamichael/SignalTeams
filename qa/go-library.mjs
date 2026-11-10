export default async function run(page, ui) {
  await page.locator('.rail-ico').first().click()          // 📡 home
  await page.waitForTimeout(800)
  await page.getByText('Agent Library', { exact: false }).first().click({ timeout: 8000 })
  await page.waitForTimeout(1200)
  return { snap: await ui.snapshot({full:true}) }
}
