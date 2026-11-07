export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input');
  let snap = await ui.snapshot();
  const crew = snap.match(/@(e\d+) button "crew account"/)?.[1];
  if (crew) { await ui.click(crew); await page.waitForTimeout(600); snap = await ui.snapshot(); }
  const inputs = [...snap.matchAll(/@(e\d+) textbox/g)].map(m => m[1]);
  await ui.fill(inputs[0], 'hooktester');
  await ui.fill(inputs[1], 'password');
  const signIn = snap.match(/@(e\d+) button "(?:Sign in|Log in|Buzz in|Enter)"/)?.[1]
    || [...snap.matchAll(/@(e\d+) button/g)].map(m => m[1]).pop();
  await ui.click(signIn);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: 'D:/AgentHive/qa/after-login.png' });
  out.railHTML = await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].map(e => e.getAttribute('title') + '|' + e.textContent.slice(0, 12)));
  out.bodySnippet = (await page.evaluate(() => document.body.innerText)).slice(0, 600);
  return out;
}
