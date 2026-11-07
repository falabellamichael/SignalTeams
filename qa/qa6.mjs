export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'juno');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1500);

  // bell — juno should see events about SousChef (mike benched/reviewed it)
  const bellCount = await page.evaluate(() =>
    document.querySelector('button[title="Notifications"] .rail-badge')?.textContent || '0');
  out.bellCount = bellCount;
  await page.click('button[title="Notifications"]');
  await page.waitForTimeout(500);
  out.bellText = await page.evaluate(() =>
    document.querySelector('.spanel')?.innerText?.slice(0, 300) || 'no panel');
  await shot("bell");
  await page.keyboard.press('Escape');
  await page.click('.topbar .title').catch(() => {});

  // streaming try — watch token count grow
  await page.click('text=Agent Library');
  await page.waitForTimeout(800);
  await page.click('.acard:has-text("SousChef")');
  await page.waitForTimeout(500);
  await page.click('.ftab:has-text("Try it")');
  await page.waitForTimeout(400);
  await page.fill('.modal .composer textarea', 'quick: what can I make with just pasta?');
  await page.keyboard.press('Enter');
  // sample content at 2s, 6s, final
  const lens = [];
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(2000);
    const l = await page.evaluate(() =>
      document.querySelector('.pmsg.assistant .ptext')?.textContent?.length || 0);
    lens.push(l);
    const done = await page.evaluate(() => {
      const m = document.querySelector('.pmsg.assistant .pmeta');
      return m && m.textContent.includes('ollama');
    });
    if (done && i > 2 && lens[lens.length - 1] === lens[lens.length - 2]) break;
  }
  out.streamLens = lens;
  out.streamed = lens.length > 1 && lens[1] > 0 && lens[lens.length - 1] > lens[1];
  await shot("stream");
  return out;
}
