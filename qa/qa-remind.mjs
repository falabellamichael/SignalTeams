export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  if (await page.evaluate(() => [...document.querySelectorAll('input[type="password"]')].length > 0)) {
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
      .find((t) => t.innerText.trim() === 'general')?.closest('.nav-item')?.click());
  await page.waitForTimeout(1200);

  const typeDraft = async (v) => page.evaluate((val) => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, val);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  // bad format → error chip
  await typeDraft('/remind foo');
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.title === 'Send')?.click());
  await page.waitForTimeout(400);
  out.badErr = await page.evaluate(() =>
    document.querySelector('.send-err, .senderr, [class*="err"]')?.innerText || null);
  // good format
  await typeDraft('/remind 10s grab coffee');
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.title === 'Send')?.click());
  await page.waitForTimeout(1000);
  out.confirm = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg .text')];
    return msgs.at(-1)?.innerText;
  });
  // wait for delivery
  await page.waitForTimeout(11000);
  out.delivery = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg')];
    const last = msgs.at(-1);
    return { who: last?.querySelector('.who')?.innerText,
             text: last?.querySelector('.text')?.innerText };
  });
  // draft restored? no — confirm it cleared
  out.draftEmpty = await page.evaluate(() =>
    document.querySelector('.composer textarea')?.value === '');
  return out;
}
