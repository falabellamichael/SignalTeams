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

  // post a :name: message via the composer
  await page.evaluate(() => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, 'inside joke :party_parrot: and :unknown_one: plain');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.title === 'Send')?.click());
  await page.waitForTimeout(1200);

  out.rendered = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg .text')];
    const last = msgs[msgs.length - 1];
    const imgs = last?.querySelectorAll('img.md-emoji');
    return {
      imgCount: imgs?.length,
      titles: [...(imgs || [])].map((i) => i.title),
      hasUnknownLiteral: last?.innerText.includes(':unknown_one:'),
      text: last?.innerText,
    };
  });

  // emoji picker — custom section on top
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.title === 'Emoji')?.click());
  await page.waitForTimeout(400);
  out.picker = await page.evaluate(() => {
    const pop = document.querySelector('.emoji-pop');
    const heads = [...pop.querySelectorAll('.ep-head')].map((h) => h.innerText);
    const imgs = pop.querySelectorAll('img.md-emoji');
    return { heads, customImgs: imgs.length,
             customTitle: imgs[0]?.getAttribute('alt') };
  });
  // click the custom emoji → inserts :name: into draft
  await page.evaluate(() =>
    document.querySelector('.emoji-pop img.md-emoji')?.closest('span')?.click());
  await page.waitForTimeout(300);
  out.draftAfterPick = await page.evaluate(() =>
    document.querySelector('.composer textarea')?.value);
  return out;
}
