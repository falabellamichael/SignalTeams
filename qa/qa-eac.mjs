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
      .find((t) => t.innerText.trim() === 'general')?.closest('.nav-item')?.click());
  await page.waitForTimeout(1200);

  // type :par → emoji autocomplete
  const typeDraft = async (v) => page.evaluate((val) => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, val);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await typeDraft('test :par');
  await page.waitForTimeout(400);
  out.popup = await page.evaluate(() =>
    [...document.querySelectorAll('.mopt')].map((o) => o.innerText));
  // pick it with Enter
  await page.evaluate(() => document.querySelector('.composer textarea')?.focus());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  out.draft = await page.evaluate(() => document.querySelector('.composer textarea')?.value);
  // send
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.title === 'Send')?.click());
  await page.waitForTimeout(1200);
  out.sent = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg .text')];
    const last = msgs[msgs.length - 1];
    const img = last?.querySelector('img.md-emoji');
    return { text: last?.innerText, emojiTitle: img?.title, imgCount: last?.querySelectorAll('img.md-emoji').length };
  });
  return out;
}
