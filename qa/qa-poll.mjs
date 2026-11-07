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

  // post a poll via the composer
  await page.evaluate(() => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '/poll LAN party friday? | yes im in | cant make it | maybe late');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.title === 'Send')?.click());
  await page.waitForTimeout(1200);

  out.pollCard = await page.evaluate(() => {
    const poll = [...document.querySelectorAll('.poll')].pop();
    if (!poll) return null;
    return {
      opts: [...poll.querySelectorAll('.poll-opt')].map((o) => ({
        key: o.querySelector('.poll-key')?.innerText,
        txt: o.querySelector('.poll-txt')?.innerText,
        n: o.querySelector('.poll-n')?.innerText,
        barW: o.querySelector('.poll-bar')?.style.width,
        mine: o.className.includes('mine'),
      })),
      q: poll.closest('.msg')?.querySelector('.text')?.innerText,
      extraReacts: poll.closest('.msg')?.querySelector('.reacts') ? 'yes' : 'no',
    };
  });

  // click option 3 → vote lands, mine flag + count
  await page.evaluate(() =>
    [...document.querySelectorAll('.poll .poll-opt')].pop()?.click());
  await page.waitForTimeout(1000);
  out.afterVote = await page.evaluate(() => {
    const poll = [...document.querySelectorAll('.poll')].pop();
    return [...poll.querySelectorAll('.poll-opt')].map((o) => ({
      n: o.querySelector('.poll-n')?.innerText,
      barW: o.querySelector('.poll-bar')?.style.width,
      mine: o.className.includes('mine'),
    }));
  });

  // bad poll format → error chip
  await page.evaluate(() => {
    const ta = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '/poll just a question');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((b) => b.title === 'Send')?.click());
  await page.waitForTimeout(400);
  out.badFormat = await page.evaluate(() =>
    document.querySelector('.slow-chip.err')?.innerText);
  return out;
}
