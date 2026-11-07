export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title === 'Signal HQ')?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')]
      .find((t) => t.innerText.trim() === 'general')?.closest('.nav-item')?.click());
  await page.waitForTimeout(1400);
  // open the thread on "thread probe root"
  out.rootVisible = await page.evaluate(() =>
    document.body.innerText.includes('thread probe root'));
  await page.evaluate(() => {
    const m = [...document.querySelectorAll('.msg')].find((x) =>
      x.innerText.includes('thread probe root'));
    m?.querySelector('.tchip, [class*="reply"], .thr')?.click()
      ?? [...m.querySelectorAll('button,span')].find((b) => b.innerText.includes('repl'))?.click();
  });
  await page.waitForTimeout(1200);
  out.threadOpen = await page.evaluate(() =>
    !!document.querySelector('.tpanel, .thread-panel, .tp-replies'));
  out.threadMsgs = await page.evaluate(() =>
    [...document.querySelectorAll('.tpanel .msg, .thread-panel .msg, .tp-replies .msg')]
      .map((x) => x.innerText.slice(0, 70)));
  await page.screenshot({ path: 'D:/AgentHive/qa-thread-agent.png' });
  // main feed should NOT contain the bot's in-thread reply as a root message
  out.botAtRoot = await page.evaluate(() =>
    [...document.querySelectorAll('.chat .msg, .mlist .msg')].filter((x) =>
      x.innerText.includes('brain\'s offline')).length);
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
