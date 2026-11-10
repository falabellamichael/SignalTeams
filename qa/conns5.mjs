export default async function run(page, ui) {
  const out = {}
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(() => document.body.textContent.includes('Buzz') || document.querySelector('.modal'), {timeout:20000})
  await new Promise(r=>setTimeout(r,1500))
  // open settings via gear
  await page.evaluate(() => {
    const g=[...document.querySelectorAll('button')].find(b=>/settings/i.test(b.title||b.ariaLabel||b.textContent)&&!b.closest('.modal'))
    g?.click()
  })
  await new Promise(r=>setTimeout(r,1000))
  await page.evaluate(() => {
    const n=[...document.querySelectorAll('button')].find(b=>/Connections/i.test(b.title||b.ariaLabel||b.textContent))
    n?.click()
  })
  await new Promise(r=>setTimeout(r,1200))
  out.sections = await page.$$eval('.con-sect', els => els.map(e=>e.textContent.trim()))
  out.count = await page.$$eval('.con-card', els => els.length)
  out.subs = await page.$$eval('.con-card', els => els.filter(e=>e.querySelector('.con-tag.subscription')).map(e=>e.querySelector('b')?.textContent))
  out.keys = await page.$$eval('.con-card', els => els.filter(e=>e.querySelector('.con-tag:not(.subscription)')).map(e=>e.querySelector('b')?.textContent))
  out.detected = await page.$$eval('.con-card', els => els.filter(e=>/local login found/.test(e.textContent)).map(e=>e.querySelector('b')?.textContent))
  await page.screenshot({path:'qa/conns-v2.png'})
  return out
}
