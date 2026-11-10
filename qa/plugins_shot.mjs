export default async function run(page, ui) {
  const out = {}
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(() => document.body.textContent.includes('Buzz'), {timeout:20000})
  await new Promise(r=>setTimeout(r,1200))
  await page.evaluate(() => { const g=[...document.querySelectorAll('button')].find(b=>/settings/i.test(b.title||b.ariaLabel||'')&&!b.closest('.modal')); g?.click() })
  await new Promise(r=>setTimeout(r,900))
  await page.evaluate(() => { const n=[...document.querySelectorAll('button')].find(b=>(b.ariaLabel||b.title)==='Connections'); n?.click() })
  await new Promise(r=>setTimeout(r,1100))
  await page.evaluate(() => { const t=[...document.querySelectorAll('.con-toggle button')].find(b=>/Plugins/i.test(b.textContent)); t?.click() })
  await new Promise(r=>setTimeout(r,1100))
  out.outlookCard = await page.evaluate(() => {
    const c=[...document.querySelectorAll('.con-card')].find(x=>/Outlook Mail/.test(x.textContent));
    return c ? c.textContent.slice(0,220) : 'missing'
  })
  await page.screenshot({path:'qa/plugins-new.png'})
  return out
}
