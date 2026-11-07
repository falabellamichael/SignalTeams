export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1300);
  await page.click('.rail-ico[title="The Hive"]');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('general'))?.click();
  });
  await page.waitForTimeout(1000);

  const sendText = async (t) => {
    await page.evaluate((x) => {
      const inp = document.querySelector('.composer textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(inp, x);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, t);
    await page.click('.composer button[title="Send"]');
    await page.waitForTimeout(800);
  };

  // slash commands
  await sendText('/shrug');
  await sendText('/roll 2d6');
  await sendText('/me waves at the hive');
  out.slash = await page.evaluate(() =>
    [...document.querySelectorAll('.msg .text')].slice(-3).map((t) => t.innerText));

  // summon the agent → creates an "answered" buzz event
  await sendText('@souschef quick one: best herb for toast?');
  await page.waitForTimeout(12000);   // local LLM latency

  // clickable mention → profile modal
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.msg .md-mention')]
      .find((c) => c.innerText === '@juno' && !c.className.includes('ag'));
    chip?.click();
  });
  await page.waitForTimeout(800);
  out.profileOpened = await page.evaluate(() =>
    document.querySelector('.modal h3')?.innerText || null);
  await shot("mention-profile");
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // agent mention chip → agent modal
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.msg .md-mention.ag')][0];
    chip?.click();
  });
  await page.waitForTimeout(800);
  out.agentOpened = await page.evaluate(() =>
    document.querySelector('.modal h3')?.innerText || null);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // buzz feed shows the agent's answer event
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('Buzz'))?.click();
  });
  await page.waitForTimeout(1000);
  out.buzzLine = await page.evaluate(() =>
    [...document.querySelectorAll('.buzz-item .bt')]
      .find((b) => b.innerText.includes('summons'))?.innerText || null);
  await shot("buzz-answered");
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
