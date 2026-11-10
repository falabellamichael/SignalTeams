export default async function run(page, ui) {
  const out = {}
  const navEl = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find(b=>/Connections/i.test(b.title||b.ariaLabel||b.textContent)))
  const nav = await navEl.asElement()
  if (nav) await page.evaluate(el=>el.click(), nav)
  await new Promise(r=>setTimeout(r,800))
  out.sections = await page.$$eval('.con-sect', els => els.map(e=>e.textContent.trim()))
  out.cards = await page.$$eval('.con-card', els => els.map(e => {
    const name = e.querySelector('.con-top')?.textContent.trim().replace(/\s+/g,' ')
    const tag = e.querySelector('.con-tag')?.textContent.trim()
    const ok = !!e.querySelector('.con-ok')
    const btns = [...e.querySelectorAll('button')].map(b=>b.textContent.trim()).join('|')
    return `${name} [${tag}]${ok?' CONNECTED':''} :: ${btns}`
  }))
  await page.screenshot({path:'qa/conns.png'})
  return out
}
