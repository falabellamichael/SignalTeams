export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  const hasLogin = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="password"]')].length > 0);
  if (hasLogin) {
    await page.fill('input >> nth=0', 'mike');
    await page.fill('input[type="password"]', 'password');
    await page.click('button.primary');
  }
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title === 'Signal HQ')?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')]
      .find((t) => t.innerText.trim() === 'show-and-tell')?.closest('.nav-item')?.click());
  await page.waitForTimeout(1200);

  // autocomplete: type @mod → role option should appear
  await page.evaluate(() => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '@mod');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  out.autocomplete = await page.evaluate(() =>
    [...document.querySelectorAll('.mopt')].map((o) => o.innerText));

  // finish the mention via the popup pick, add text, send
  await page.evaluate(() => document.querySelector('.mopt')?.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true })));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ta.value + ' — role ping render test');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.title === 'Send')?.click());
  await page.waitForTimeout(1200);

  out.rendered = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('.msg .text .md-mention.role')];
    const last = chips[chips.length - 1];
    return { count: chips.length, text: last?.innerText,
             color: last?.style.color, title: last?.title };
  });
  return out;
}
