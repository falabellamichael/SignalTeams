export default async function run(page, ui) {
  const out = {}
  const nav = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find(b=>/Connections/i.test(b.title||b.ariaLabel||b.textContent)))
  const n = await nav.asElement(); if (n) await page.evaluate(el=>el.click(), n)
  await new Promise(r=>setTimeout(r,700))
  // open openai card's import row: click "Import local login"
  out.clicked = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.con-card')].find(c=>/OpenAI/.test(c.textContent))
    const b = card && [...card.querySelectorAll('button')].find(x=>/Import local login/.test(x.textContent))
    if (!b) return false
    b.click(); return true
  })
  await new Promise(r=>setTimeout(r,1800))
  out.openaiCard = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.con-card')].find(c=>/OpenAI/.test(c.textContent))
    return card ? card.textContent.replace(/\s+/g,' ').slice(0,300) : null
  })
  out.flash = await page.$eval('.con-flash', e=>e.textContent).catch(()=>null)
  await page.screenshot({path:'qa/conns-openai.png'})
  return out
}
