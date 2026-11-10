export default async function run(page, ui) {
  // switch to register mode
  await page.getByText('Create an account').click()
  await page.waitForTimeout(300)

  const snap = await ui.snapshot()
  // fill the Supabase email + password
  const email = snap.match(/@(e\d+) textbox "you@example.com"/)?.[1]
  const boxes = [...snap.matchAll(/@(e\d+) textbox(?:"[^"]*")?/g)].map(m => m[1])
  await ui.fill(email, 'FalabellaSocial@gmail.com')
  // display name box is the one without a placeholder; password is type=password (shows as textbox too)
  // fill display name (optional) then password
  for (const b of boxes) {
    if (b !== email) {
      const ph = await ui.ref('@' + b).getAttribute('placeholder')
      if (ph === 'optional') await ui.fill('@' + b, 'Falabella')
      else await ui.fill('@' + b, 'Maitland1')
    }
  }
  await page.waitForTimeout(200)
  const snap2 = await ui.snapshot()
  const btn = snap2.match(/@(e\d+) button "Create account"/)?.[1]
  if (!btn) return { error: 'no create button', snap2 }
  await ui.click(btn)
  await page.waitForTimeout(2500)
  return { after: await ui.snapshot(), url: page.url() }
}
