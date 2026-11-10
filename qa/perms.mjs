export default async function run(page, ui) {
  const out = {}
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(() => document.body.textContent.includes('Buzz'), {timeout:20000})
  await new Promise(r=>setTimeout(r,1200))
  await page.evaluate(() => { const g=[...document.querySelectorAll('button')].find(b=>/settings/i.test(b.title||b.ariaLabel||'')&&!b.closest('.modal')); g?.click() })
  await new Promise(r=>setTimeout(r,900))
  await page.evaluate(() => { const n=[...document.querySelectorAll('button')].find(b=>(b.ariaLabel||b.title)==='Permissions'); n?.click() })
  await new Promise(r=>setTimeout(r,1600))
  out.permRows = await page.evaluate(() => [...document.querySelectorAll('.perm-state')].map(x=>x.parentElement.textContent.trim().split(/Allow|Re-check/)[0].trim()+' -> '+x.textContent))
  out.agentCards = await page.evaluate(() => [...document.querySelectorAll('.perm-row')].map(x=>x.closest('.con-card')?.querySelector('.con-top b')?.textContent))
  out.selects = await page.evaluate(() => document.querySelectorAll('.perm-row select').length)
  await page.screenshot({path:'qa/perms.png'})
  return out
}
