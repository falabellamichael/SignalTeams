export default async function run(page, ui) {
  const out = {}
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(() => document.body.textContent.includes('Buzz'), {timeout:20000})
  await new Promise(r=>setTimeout(r,1200))
  await page.evaluate(() => { const g=[...document.querySelectorAll('button')].find(b=>/settings/i.test(b.title||b.ariaLabel||b.textContent)&&!b.closest('.modal')); g?.click() })
  await new Promise(r=>setTimeout(r,900))
  await page.evaluate(() => { const n=[...document.querySelectorAll('button')].find(b=>/Connections/i.test(b.title||b.ariaLabel||b.textContent)); n?.click() })
  await new Promise(r=>setTimeout(r,1000))
  await page.evaluate(() => { const t=[...document.querySelectorAll('.con-toggle button')].find(b=>/Plugins/i.test(b.textContent)); t?.click() })
  await new Promise(r=>setTimeout(r,1000))
  out.cards = await page.$$eval('.con-card', els => els.map(e=>{
    const name=e.querySelector('b')?.textContent
    const btns=[...e.querySelectorAll('.con-actions button, .con-actions span')].map(x=>x.textContent.trim()).join('|')
    return `${name}: ${btns}`
  }))
  // click Connect on github card → device code should appear
  await page.evaluate(() => {
    const c=[...document.querySelectorAll('.con-card')].find(x=>/GitHub/.test(x.textContent))
    const b=[...c.querySelectorAll('button')].find(x=>/Connect/.test(x.textContent)); b?.click()
  })
  await new Promise(r=>setTimeout(r,2500))
  out.githubCard = await page.evaluate(() => {
    const c=[...document.querySelectorAll('.con-card')].find(x=>/GitHub/.test(x.textContent))
    return { code: c?.querySelector('.con-code')?.textContent || null,
             txt: c?.querySelector('.con-device')?.textContent.replace(/\s+/g,' ').slice(0,140) || null }
  })
  await page.screenshot({path:'qa/plugins-v3.png'})
  return out
}
