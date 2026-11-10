export default async function run(page, ui) {
  const out = { url: page.url() }
  try {
    await page.goto('http://localhost:5175/', { waitUntil: 'domcontentloaded', timeout: 20000 })
    out.nav = 'ok'
  } catch (e) { out.nav = String(e).slice(0, 200) }
  out.url2 = page.url()
  out.html = (await page.content()).length
  return out
}
