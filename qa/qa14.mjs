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

  // @-popup should offer agents too
  await page.fill('.composer textarea', '@sou');
  await page.waitForTimeout(600);
  out.agentOpt = await page.evaluate(() =>
    [...document.querySelectorAll('.mopt')].map((o) => o.innerText.replace(/\n/g, ' ')));
  await shot("agent-mention-pop");

  // pick the agent option, finish the question, send
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  out.composer = await page.inputValue('.composer textarea');
  await page.fill('.composer textarea', out.composer + 'quick dinner idea?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);

  // my message should carry a honey agent-mention chip
  out.agChip = await page.evaluate(() =>
    [...document.querySelectorAll('.md-mention.ag')].map((s) => s.innerText));

  // typing indicator should show while the LLM generates
  await page.waitForTimeout(2500);
  out.typing = await page.evaluate(() =>
    document.querySelector('.typing')?.innerText || '');
  await shot("agent-typing");

  // wait for the bot reply (llama3 can take a while)
  out.botMsg = 'none';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(2000);
    const found = await page.evaluate(() => {
      const msgs = [...document.querySelectorAll('.msg')];
      const m = msgs.find((x) => x.querySelector('.author')?.innerText === 'SousChef');
      return m ? {
        text: m.querySelector('.text')?.innerText?.slice(0, 160),
        quote: m.querySelector('.reply-quote')?.innerText?.replace(/\n/g, ' '),
      } : null;
    });
    if (found) { out.botMsg = found; break; }
  }
  await shot("agent-reply");

  // bell should have the mention ping
  await page.click('.bell, [title="Notifications"], .icon-btn:has-text("🔔")').catch(() => {});
  await page.waitForTimeout(700);
  out.bellHasMention = await page.evaluate(() =>
    document.body.innerText.includes('mentioned you'));
  await shot("agent-bell");

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
