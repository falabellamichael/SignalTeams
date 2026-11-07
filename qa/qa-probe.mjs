export default async function run(page, ui) {
  await page.waitForTimeout(15000);
  return {
    hasRoot: await page.evaluate(() => !!document.getElementById('root')),
    rootHtml: await page.evaluate(() => document.getElementById('root')?.innerHTML.slice(0, 300)),
    inputs: await page.evaluate(() => document.querySelectorAll('input').length),
    scripts: await page.evaluate(() => [...document.scripts].map(s => s.src || s.type).slice(0, 6)),
    st: await page.evaluate(() => typeof window.__st),
  };
}
