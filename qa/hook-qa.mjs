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
  await page.waitForSelector('div.rail-ico[title^="HookOps"]', { timeout: 15000 });

  await page.evaluate(() =>
    [...document.querySelectorAll('div.rail-ico')].find(e => e.title.startsWith('HookOps')).click());
  await page.waitForTimeout(1800);

  const gears = await page.$$('span.ch-gear[title="Edit channel"]');
  if (!gears.length) {
    return { ...out, error: 'no channel gear', snap: (await ui.snapshot()).slice(0, 2500) };
  }
  await gears[0].evaluate(e => e.click());
  await page.waitForTimeout(1500);

  const modal = await ui.snapshot({ full: true });
  out.webhooksSection = modal.includes('Incoming webhooks');
  out.deployBotListed = modal.includes('Deploy Bot');
  await page.screenshot({ path: 'D:/AgentHive/qa/hook-modal.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  out.botTags = await page.$$eval('.bot-tag', els => els.map(e => e.textContent)).catch(() => []);
  out.viaTags = await page.$$eval('.via-tag', els => els.map(e => e.textContent)).catch(() => []);
  const bodyText = await page.evaluate(() => document.body.innerText);
  out.hookMsgSeen = ['CPU spike', 'disk at 92%', 'Deployment', 'plain text post'].filter(t => bodyText.includes(t));
  await page.screenshot({ path: 'D:/AgentHive/qa/hook-chat.png' });
  return out;
}
