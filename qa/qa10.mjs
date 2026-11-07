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

  // type "@ju" → popup should show Juno
  await page.fill('.composer textarea', 'hey @ju');
  await page.waitForTimeout(500);
  out.popOpts = await page.evaluate(() =>
    [...document.querySelectorAll('.mopt')].map((o) => o.innerText.replace(/\n/g, ' ')));
  await shot("mention-pop");

  // Enter picks the highlighted option
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  out.draftAfter = await page.evaluate(() => document.querySelector('.composer textarea').value);

  await page.keyboard.type('check this agent drop');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  out.mentionChip = await page.evaluate(() =>
    document.querySelector('.msg:last-of-type .md-mention')?.innerText || 'none');
  await shot("mention-msg");

  // switch to juno — bell should show the mention, click jumps to #general
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(700);
  await page.fill('input >> nth=0', 'juno');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1400);

  await page.click('button[title="Notifications"]');
  await page.waitForTimeout(600);
  out.bellText = await page.evaluate(() =>
    document.querySelector('.spanel')?.innerText.slice(0, 200) || 'no-panel');
  await shot("bell-mention");

  // click the mention notification → should land in #general
  await page.click('.spanel .ideopt:has-text("mentioned you")');
  await page.waitForTimeout(900);
  out.landedTitle = await page.evaluate(() =>
    document.querySelector('.topbar .title')?.innerText || 'none');
  out.highlightForMe = await page.evaluate(() =>
    [...document.querySelectorAll('.md-mention.me')].map((e) => e.innerText));
  await shot("mention-juno");

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
