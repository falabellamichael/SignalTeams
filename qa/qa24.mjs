export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);
  await page.click('.rail-ico[title="The Hive"]');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('general'))?.click();
  });
  await page.waitForTimeout(1000);

  // hover first message → click 🧵 in the react-bar
  const msgCount0 = await page.evaluate(() => document.querySelectorAll('.msg').length);
  await page.hover('.msg >> nth=0');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const bar = document.querySelectorAll('.msg')[0].querySelector('.react-bar');
    [...bar.children].find((s) => s.title === 'Thread')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(900);
  out.panelOpen = await page.evaluate(() => !!document.querySelector('.thread-panel'));
  await shot("thread-open");

  // send two replies in the thread
  for (const txt of ['thread reply one', 'second threaded thought']) {
    await page.evaluate((t) => {
      const inp = document.querySelector('.tp-composer textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(inp, t);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, txt);
    await page.waitForTimeout(200);
    await page.click('.tp-composer button[title="Send"]');
    await page.waitForTimeout(900);
  }
  out.replies = await page.evaluate(() =>
    document.querySelectorAll('.tp-msgs .msg').length);
  out.chip = await page.evaluate(() =>
    document.querySelector('.thread-chip')?.innerText);
  // thread replies must NOT appear in the main feed
  out.mainFeedLeaked = await page.evaluate(() =>
    [...document.querySelectorAll('.msgs .msg .text')]
      .some((t) => t.innerText.includes('thread reply one')));
  await shot("thread-replies");
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
