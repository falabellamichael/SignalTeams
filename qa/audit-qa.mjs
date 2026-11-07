export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input');
  let snap = await ui.snapshot();
  const crew = snap.match(/@(e\d+) button "crew account"/)?.[1];
  if (crew) { await ui.click(crew); await page.waitForTimeout(600); snap = await ui.snapshot(); }
  const inputs = [...snap.matchAll(/@(e\d+) textbox/g)].map(m => m[1]);
  await ui.fill(inputs[0], 'auditer');
  await ui.fill(inputs[1], 'password');
  const signIn = snap.match(/@(e\d+) button "(?:Sign in|Log in|Buzz in|Enter)"/)?.[1]
    || [...snap.matchAll(/@(e\d+) button/g)].map(m => m[1]).pop();
  await ui.click(signIn);
  await page.waitForSelector('div.rail-ico[title^="AuditCo"]', { timeout: 15000 });

  await page.evaluate(() =>
    [...document.querySelectorAll('div.rail-ico')].find(e => e.title.startsWith('AuditCo')).click());
  await page.waitForTimeout(1500);

  // server settings via header ⚙ button
  const opened = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, span')];
    const b = btns.find(e => e.title && /server settings|settings/i.test(e.title));
    if (b) { b.click(); return b.title; }
    return null;
  });
  out.settingsBtn = opened;
  await page.waitForTimeout(1200);

  // expand audit log
  const expanded = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('label')];
    const l = labels.find(e => e.textContent.includes('Audit log'));
    if (l) { l.click(); return true; }
    return false;
  });
  out.auditLabelFound = expanded;
  await page.waitForTimeout(1500);

  const bodyText = await page.evaluate(() => document.body.innerText);
  out.rows = ['member.kick', 'hook.delete', 'invite.rotate', 'role.create', 'channel.create']
    .map(a => bodyText.includes(a));
  out.verbs = ['kicked', 'deleted webhook', 'rotated the invite', 'created role', 'created channel']
    .filter(v => bodyText.includes(v));
  await page.screenshot({ path: 'D:/AgentHive/qa/audit-modal.png' });
  return out;
}
