export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input');
  let snap = await ui.snapshot();
  const crew = snap.match(/@(e\d+) button "crew account"/)?.[1];
  if (crew) { await ui.click(crew); await page.waitForTimeout(600); snap = await ui.snapshot(); }
  const inputs = [...snap.matchAll(/@(e\d+) textbox/g)].map(m => m[1]);
  await ui.fill(inputs[0], 'owner1');
  await ui.fill(inputs[1], 'password');
  const signIn = snap.match(/@(e\d+) button "(?:Sign in|Log in|Buzz in|Enter)"/)?.[1]
    || [...snap.matchAll(/@(e\d+) button/g)].map(m => m[1]).pop();
  await ui.click(signIn);
  await page.waitForSelector('div.rail-ico[title^="SysTest"]', { timeout: 15000 });
  await page.evaluate(() =>
    [...document.querySelectorAll('div.rail-ico')].filter(e => e.title.startsWith('SysTest')).pop().click());
  await page.waitForTimeout(1500);
  out.clicked = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.nav-item')]
      .find(e => /general/i.test(e.textContent));
    if (el) { el.click(); return el.textContent.trim(); }
    return null;
  });
  await page.waitForTimeout(1800);
  out.sysmsg = await page.evaluate(() =>
    [...document.querySelectorAll('.sysmsg')].map(x => x.textContent.trim()));
  out.msgCount = await page.evaluate(() =>
    document.querySelectorAll('.sysmsg, .msg, [class*=msg]').length);
  await page.screenshot({ path: 'qa/qa-sysmsg-chat.png', fullPage: false });
  return out;
}
