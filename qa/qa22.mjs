export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);

  // Ctrl+K opens global search
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(500);
  out.gsearchOpened = await page.evaluate(() =>
    document.body.innerText.includes('Search everywhere'));
  // Esc closes it
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  out.escClosed = await page.evaluate(() =>
    !document.querySelector('.modal'));

  // bell → remix notification → pack modal
  await page.click('button[title="Notifications"]');
  await page.waitForTimeout(900);
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('.spanel .ideopt')].map((e) => e.innerText.replace(/\n/g, ' ').slice(0, 80)));
  out.bellItems = items.slice(0, 5);
  const remix = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.spanel .ideopt')]
      .find((e) => e.innerText.includes('remixed'));
    if (el) { el.click(); return el.innerText; }
    return null;
  });
  out.remixClicked = remix ? remix.replace(/\n/g, ' ').slice(0, 80) : null;
  await page.waitForTimeout(900);
  out.packModal = await page.evaluate(() => {
    const t = document.querySelector('.modal h3')?.innerText;
    const agents = document.querySelectorAll('.modal .pack-agent').length;
    return t ? `${t} · ${agents} agent rows` : null;
  });
  await shot("bell-remix-pack");
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
