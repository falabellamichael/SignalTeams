export default async function run(page, ui) {
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
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button, span')].find(e => e.title && /settings/i.test(e.title));
    if (b) b.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find(e => e.textContent.includes('Audit log'));
    if (l) l.click();
  });
  await page.waitForTimeout(1400);
  // scroll modal content to the audit section
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find(e => e.textContent.includes('Audit log'));
    if (l) l.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'D:/AgentHive/qa/audit-open.png' });
  return { done: true };
}
