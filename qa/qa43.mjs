export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
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
  await page.waitForTimeout(1500);
  out.initial = await page.evaluate(() => ({
    msgs: document.querySelectorAll('.msg').length,
    hint: !!document.querySelector('.msgs .idehint'),
    first: document.querySelector('.msg')?.innerText.slice(0, 40),
  }));
  // scroll to top → should load older page, preserving position
  const info = () => page.evaluate(() => {
    const el = document.querySelector('.msgs');
    return { msgs: document.querySelectorAll('.msg').length,
             top: el.scrollTop, first: document.querySelector('.msg')?.innerText.slice(0, 40) };
  });
  await page.evaluate(() => { document.querySelector('.msgs').scrollTop = 0; });
  await page.waitForTimeout(1800);
  out.afterPage1 = await info();
  await page.evaluate(() => { document.querySelector('.msgs').scrollTop = 0; });
  await page.waitForTimeout(1800);
  out.afterPage2 = await info();
  await page.screenshot({ path: 'D:/AgentHive/qa-paged.png' });
  return out;
}
