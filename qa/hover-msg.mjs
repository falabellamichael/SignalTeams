export default async function run(page, ui) {
  // hover over the message text to reveal the hover toolbar
  const msg = page.getByText('hello from the new account', { exact: false })
  await msg.hover()
  await page.waitForTimeout(400)
  return { snap: await ui.snapshot() }
}
