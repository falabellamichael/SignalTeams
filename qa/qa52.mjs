export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  // nova (WS online? no — REST) — post @here as juno, mike IS ws-online via this page
  await page.evaluate(async () => {
    const j = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'juno', password: 'password' }) }).then((x) => x.json());
    await fetch('/api/channels/2/messages', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + j.token },
      body: JSON.stringify({ content: '@here deploy freeze in 10!' }) });
  });
  await page.waitForTimeout(1400);
  // mike is WS-online → @here ping should reach him → @n pill on agent-drops
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title?.includes('Signal HQ'))?.click());
  await page.waitForTimeout(1600);
  out.hereBadge = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.side-body .nav-item')]
      .find((x) => x.innerText.includes('agent-drops'));
    return row?.querySelector('.cnt')?.innerText + "|ping:" + !!row?.querySelector('.cnt.ping');
  });
  // open agent-drops, check the @here + @everyone chips render with bcast style
  await page.evaluate(() =>
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((x) => x.innerText.includes('agent-drops'))?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((x) => x.innerText.includes('general'))?.click());
  await page.waitForTimeout(1500);
  out.chips = await page.evaluate(() =>
    [...document.querySelectorAll('.md-mention.bcast')].map((c) => c.innerText));
  await page.screenshot({ path: 'D:/AgentHive/qa-everyone.png' });
  return out;
}
