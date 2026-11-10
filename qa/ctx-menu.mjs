export default async function run(page, ui) {
  const msg = page.locator('.msg .text', { hasText: 'hello from the new account' })
  await msg.click({ button: 'right' })
  await page.waitForTimeout(500)
  return { snap: await ui.snapshot({full:true}) }
}
