export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  // open inbox via 📥
  await page.evaluate(() =>
    [...document.querySelectorAll('.topbar .ghost')]
      .find((b) => b.innerText === '📥')?.click());
  await page.waitForTimeout(1200);
  out.inbox = await page.evaluate(() => ({
    title: document.querySelector('.modal h3')?.innerText,
    rows: [...document.querySelectorAll('.inbox-row')].slice(0, 4).map((r) =>
      r.innerText.trim().replace(/\s+/g, ' ').slice(0, 60)),
    n: document.querySelectorAll('.inbox-row').length }));
  await page.screenshot({ path: 'D:/AgentHive/qa-inbox.png' });
  // jump the top row → should land in #general on the fresh mention
  await page.evaluate(() => document.querySelector('.inbox-row')?.click());
  await page.waitForTimeout(1800);
  out.afterJump = await page.evaluate(() => ({
    title: document.querySelector('.topbar .title')?.innerText,
    modalGone: !document.querySelector('.modal'),
    flash: !!document.querySelector('.msg.flash, .msg.flashmsg, .flash') }));
  await page.screenshot({ path: 'D:/AgentHive/qa-inbox-jump.png' });
  return out;
}
