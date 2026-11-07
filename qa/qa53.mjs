export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title?.includes('Signal HQ'))?.click());
  await page.waitForTimeout(1800);
  out.groups = await page.evaluate(() =>
    [...document.querySelectorAll('.side-group')].map((g) => g.innerText.trim().replace(/\s+/g,' ')));
  out.rows = await page.evaluate(() => {
    const res = [];
    document.querySelectorAll('.side-body').forEach((b) => {
      let cur = '';
      [...b.children].forEach((el) => {
        if (el.classList.contains('side-group')) cur = el.innerText.trim();
        else if (el.classList.contains('nav-item')) res.push(cur + ' → ' + el.innerText.trim().split('\n')[0]);
      });
    });
    return res; });
  // collapse "chat" category
  await page.evaluate(() =>
    [...document.querySelectorAll('.side-group.cat')]
      .find((g) => g.innerText.toLowerCase().includes('chat'))?.click());
  await page.waitForTimeout(400);
  out.afterCollapse = await page.evaluate(() => ({
    rows: document.querySelectorAll('.side-body .nav-item').length,
    arrowClosed: [...document.querySelectorAll('.cat-arrow')].some((a) => !a.classList.contains('open')) }));
  await page.screenshot({ path: 'D:/AgentHive/qa-cats.png' });
  return out;
}
