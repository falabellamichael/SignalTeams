export default async function run(page, ui) {
  const out = {}
  const nav = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find(b=>/Connections/i.test(b.title||b.ariaLabel||b.textContent)))
  const n = await nav.asElement(); if (n) await page.evaluate(el=>el.click(), n)
  await new Promise(r=>setTimeout(r,800))
  out.sections = await page.$$eval('.con-sect', els => els.map(e=>e.textContent.trim()))
  out.count = await page.$$eval('.con-card', els => els.length)
  out.subCards = await page.$$eval('.con-card', els => els.filter(e=>/subscription/i.test(e.textContent)).map(e=>e.querySelector('b')?.textContent))
  out.keyCards = await page.$$eval('.con-card', els => els.filter(e=>/api key/i.test(e.textContent)).map(e=>e.querySelector('b')?.textContent))
  out.detected = await page.$$eval('.con-card', els => els.filter(e=>/local login found/.test(e.textContent)).map(e=>e.querySelector('b')?.textContent))
  out.openaiStatus = await page.evaluate(() => {
    const c=[...document.querySelectorAll('.con-card')].find(x=>/OpenAI/.test(x.textContent))
    return c?.textContent.replace(/\s+/g,' ').slice(0,200)
  })
  // open custom card key row and screenshot
  await page.evaluate(() => {
    const c=[...document.querySelectorAll('.con-card')].find(x=>/OpenAI-compatible/.test(x.textContent))
    c?.scrollIntoView({block:'center'})
  })
  await page.screenshot({path:'qa/conns-v2.png'})
  return out
}
