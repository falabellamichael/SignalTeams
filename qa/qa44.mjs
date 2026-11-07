export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'nova');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('show-and-tell'))?.click();
  });
  await page.waitForTimeout(1600);
  const info = () => page.evaluate(() => {
    const el = document.querySelector('.msgs');
    const first = document.querySelector('.msg');
    return { msgs: document.querySelectorAll('.msg').length, top: Math.round(el.scrollTop),
             hint: !!document.querySelector('.msgs .idehint'),
             firstTxt: first?.innerText.slice(0, 44),
             firstId: first?.id };
  });
  out.initial = await info();   // expect 50 + hint
  const firstBefore = (await info()).firstId;
  await page.evaluate(() => { document.querySelector('.msgs').scrollTop = 0; });
  await page.waitForTimeout(1800);
  out.paged = await info();     // expect 63, top>0 (position preserved), first=backfill 01
  out.posPreserved = out.paged.top > 0;
  out.reachedTop = await page.evaluate(() => {
    const el = document.querySelector('.msgs'); el.scrollTop = 0;
    return new Promise((r) => setTimeout(() => r(
      [...document.querySelectorAll('.msg')].some((m) => m.innerText.includes('backfill message 01'))), 1200));
  });
  return out;
}
