import { chromium } from "file:///C:/Users/Falab/edge-mcp/node_modules/playwright-core/index.mjs";
const b = await chromium.connectOverCDP("http://localhost:9333");
const ctx = b.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("127.0.0.1:8075")) || ctx.pages()[0];
const sleep = ms => new Promise(r => setTimeout(r, ms));
console.log("url:", page.url().slice(0,50));
// logged in?
const body = await page.evaluate(() => document.body.textContent.slice(0, 200));
if (/sign in|log in|crew account/i.test(body) && !/Buzz/i.test(body)) {
  console.log("login page — signing in as mike");
  await page.evaluate(() => {
    const t=[...document.querySelectorAll('button,[role=tab],a,div')].find(x=>/crew account/i.test(x.textContent)&&x.children.length<3); t?.click();
  });
  await sleep(700);
  await page.evaluate(() => {
    const ins=[...document.querySelectorAll('input')];
    const u=ins.find(i=>/user|name/i.test(i.placeholder||i.name||''))||ins[0];
    const p=ins.find(i=>i.type==='password')||ins[1];
    const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;d.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
    if(u)set(u,'mike'); if(p)set(p,'password');
  });
  await sleep(400);
  await page.evaluate(() => { const bt=[...document.querySelectorAll('button')].find(x=>/sign in|log in|continue|join/i.test(x.textContent)); bt?.click(); });
  await sleep(2500);
}
console.log("state:", (await page.evaluate(()=>document.body.textContent)).slice(0,80).replace(/\n/g,' '));
// open settings → connections → plugins → connect gmail
await page.evaluate(() => { const g=[...document.querySelectorAll('button')].find(x=>/settings/i.test(x.title||x.ariaLabel||'')&&!x.closest('.modal')); g?.click() });
await sleep(900);
await page.evaluate(() => { const n=[...document.querySelectorAll('button')].find(x=>(x.ariaLabel||x.title)==='Connections'); n?.click() });
await sleep(1100);
await page.evaluate(() => { const t=[...document.querySelectorAll('.con-toggle button')].find(x=>/Plugins/i.test(x.textContent)); t?.click() });
await sleep(900);
const clicked = await page.evaluate(() => {
  const c=[...document.querySelectorAll('.con-card')].find(x=>/Gmail/.test(x.textContent));
  const bt=c&&[...c.querySelectorAll('button')].find(x=>/Connect Gmail/.test(x.textContent));
  if(bt){bt.click();return true} return false;
});
console.log("connect clicked:", clicked);
await sleep(3500);
const cardState = await page.evaluate(() => {
  const c=[...document.querySelectorAll('.con-card')].find(x=>/Gmail/.test(x.textContent));
  return c ? c.querySelector('.con-device')?.textContent?.slice(0,140) || '(no device block)' : '(card gone)';
});
console.log("card:", cardState);
await b.close();
