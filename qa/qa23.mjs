export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  const typeDraft = (text) => page.evaluate((t) => {
    const inp = document.querySelector('.composer textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(inp, t);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);

  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);

  // open The Hive → #general
  await page.click('.rail-ico[title="The Hive"]');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('general'))?.click();
  });
  await page.waitForTimeout(1000);
  out.inChannel = await page.evaluate(() => document.querySelector('.topbar .title')?.innerText);

  // draft: type → switch channel → switch back
  await typeDraft('half-written draft survives');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => !c.className.includes('on'))?.click();
  });
  await page.waitForTimeout(900);
  out.otherComposer = await page.evaluate(() =>
    document.querySelector('.composer textarea')?.value || '(empty)');
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('general'))?.click();
  });
  await page.waitForTimeout(900);
  out.draftRestored = await page.evaluate(() =>
    document.querySelector('.composer textarea')?.value);

  // global search → jump → flash highlight
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(500);
  await page.fill('.modal input', 'toast');
  await page.waitForTimeout(1100);
  await page.evaluate(() => document.querySelector('.modal .pack-agent')?.click());
  await page.waitForTimeout(1200);
  out.jump = await page.evaluate(() => ({
    title: document.querySelector('.topbar .title')?.innerText,
    flashing: !!document.querySelector('.msg.flash'),
    flashedText: document.querySelector('.msg.flash .text')?.innerText?.slice(0, 50),
  }));
  await shot("jump-flash");
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
