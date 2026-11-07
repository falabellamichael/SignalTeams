export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};

  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);

  await page.click('.rail-ico >> nth=1');
  await page.waitForTimeout(900);
  await page.click('text=general');
  await page.waitForTimeout(700);

  // reply to juno's "eval'd it" message via hover ↩
  await page.hover('.msg:has-text("eval\'d it on 40 diffs")');
  await page.waitForTimeout(400);
  await page.click('.msg:has-text("eval\'d it on 40 diffs") .react-bar span[title="Reply"]');
  await page.waitForTimeout(400);
  out.banner = await page.evaluate(() =>
    document.querySelector('.reply-banner')?.innerText.replace(/\n/g, ' ') || 'none');
  await shot("reply-banner");

  await page.fill('.composer textarea', 'fair — it roasts me too');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1100);
  out.quote = await page.evaluate(() =>
    [...document.querySelectorAll('.reply-quote')].pop()?.innerText);
  out.replyMsg = await page.evaluate(() => {
    const qs = document.querySelectorAll('.reply-quote');
    const last = qs[qs.length - 1];
    return last?.closest('.msg')?.querySelector('.text')?.innerText || 'none';
  });
  await shot("reply-msg");

  // drag-drop: simulate via dispatching drop event is hard headless — verify the
  // veil shows on dragover instead
  out.dropVeil = await page.evaluate(() => {
    const core = document.querySelector('.chat-core');
    core.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    return new Promise((r) => setTimeout(() =>
      r(!!document.querySelector('.drop-veil')), 300));
  });
  await shot("drop-veil");
  out.veilGone = await page.evaluate(() => {
    const core = document.querySelector('.chat-core');
    core.dispatchEvent(new Event('dragleave', { bubbles: true, cancelable: true }));
    return new Promise((r) => setTimeout(() =>
      r(!document.querySelector('.drop-veil')), 300));
  });

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
