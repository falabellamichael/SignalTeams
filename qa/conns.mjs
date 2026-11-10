export default async function run(page, ui) {
  const out = {}
  // already in app (session retains state); open settings via gear in the me-bar
  const gear = await page.$('.mebar button[title*="Settings"], .me-bar button[title*="Settings"], [title="User Settings"]')
  if (gear) await gear.click().catch(()=>{})
  await new Promise(r=>setTimeout(r,900))
  out.modal = !!(await page.$('.settings-nav, .set-nav'))
  // click Connections nav
  const navBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find(b=>/Connections/i.test(b.title||b.ariaLabel||b.textContent)))
  const navEl = await navBtn.asElement()
  out.navBtn = !!navEl
  if (navEl) await page.evaluate(el=>el.click(), navEl)
  await new Promise(r=>setTimeout(r,900))
  out.cards = await page.$$eval('.con-card', els => els.slice(0,20).map(e => ({
    id: e.querySelector('.con-name')?.textContent,
    status: e.querySelector('.con-status')?.textContent
  }))).catch(e => 'err:'+e.message)
  out.groups = await page.$$eval('.con-group h3, .con-group-title', els => els.map(e=>e.textContent)).catch(()=>null)
  await page.screenshot({path:'qa/conns.png'})
  return out
}
