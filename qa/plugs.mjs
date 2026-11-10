export default async function run(page, ui) {
  const out = {}
  // settings may still be open on connections; reload for clean state
  await page.reload({waitUntil:'domcontentloaded'})
  await page.waitForFunction(() => document.body.textContent.includes('Buzz'), {timeout:20000})
  await new Promise(r=>setTimeout(r,1200))
  await page.evaluate(() => {
    const g=[...document.querySelectorAll('button')].find(b=>/settings/i.test(b.title||b.ariaLabel||b.textContent)&&!b.closest('.modal'))
    g?.click()
  })
  await new Promise(r=>setTimeout(r,900))
  await page.evaluate(() => {
    const n=[...document.querySelectorAll('button')].find(b=>/Connections/i.test(b.title||b.ariaLabel||b.textContent))
    n?.click()
  })
  await new Promise(r=>setTimeout(r,1000))
  out.toggle = await page.$$eval('.con-toggle button', els => els.map(e=>e.textContent.trim()))
  // click Plugins tab
  await page.evaluate(() => {
    const t=[...document.querySelectorAll('.con-toggle button')].find(b=>/Plugins/i.test(b.textContent))
    t?.click()
  })
  await new Promise(r=>setTimeout(r,900))
  out.pluginCards = await page.$$eval('.con-card', els => els.map(e=>{
    const name=e.querySelector('b')?.textContent
    const tag=e.querySelector('.con-tag')?.textContent
    const act=[...e.querySelectorAll('.con-actions *')].map(x=>x.textContent.trim()).join(' ')
    const setup=e.querySelector('.con-setup')?'[setup-row]':''
    return `${name} [${tag}] ${act} ${setup}`
  }))
  // save creds on gmail card via UI then check connect button appears
  await page.evaluate(() => {
    const c=[...document.querySelectorAll('.con-card')].find(x=>/Gmail/.test(x.textContent))
    const ins=c?.querySelectorAll('.con-setup input')
    if (ins && ins.length>=2){
      const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;d.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))}
      set(ins[0],'12345.apps.googleusercontent.com'); set(ins[1],'GOCSPX-test')
    }
  })
  await new Promise(r=>setTimeout(r,300))
  await page.evaluate(() => {
    const c=[...document.querySelectorAll('.con-card')].find(x=>/Gmail/.test(x.textContent))
    const b=[...c.querySelectorAll('button')].find(x=>/Save & connect/.test(x.textContent))
    b?.click()
  })
  await new Promise(r=>setTimeout(r,1500))
  out.gmailAfter = await page.evaluate(() => {
    const c=[...document.querySelectorAll('.con-card')].find(x=>/Gmail/.test(x.textContent))
    return { txt: c?.textContent.replace(/\s+/g,' ').slice(0,240),
             popup: !window._popClosed }
  })
  await page.screenshot({path:'qa/plugins.png'})
  return out
}
