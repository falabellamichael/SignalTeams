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
  await new Promise(r=>setTimeout(r,900))
  // count windows before/after clicking Connect Gmail
  const ctx = page.context()
  const before = ctx.pages().length
  await page.evaluate(() => {
    const c=[...document.querySelectorAll('.con-card')].find(x=>/Gmail/.test(x.textContent))
    const b=[...c.querySelectorAll('button')].find(x=>/Connect Gmail/.test(x.textContent)); b?.click()
  })
  await new Promise(r=>setTimeout(r,2500))
  const after = ctx.pages()
  out.newWindows = after.length - before
  out.popupUrl = after.length > before ? after[after.length-1].url().slice(0,120) : null
  out.gmailState = await page.evaluate(() => {
    const c=[...document.querySelectorAll('.con-card')].find(x=>/Gmail/.test(x.textContent))
    return c?.querySelector('.con-probe')?.textContent || c?.querySelector('.con-device')?.textContent?.slice(0,100) || 'no-error'
  })
  await page.screenshot({path:'qa/popup-fix.png'})
  return out
}
