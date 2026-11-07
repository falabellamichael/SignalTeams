export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};

  // login as mike
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1200);

  // open library → publish modal
  await page.click('text=Agent Library');
  await page.waitForTimeout(700);
  await page.click('text=+ Publish agent');
  await page.waitForTimeout(500);
  await shot("publish");

  // fill + publish
  const mi = '.modal input:not([type=file])';
  await page.fill(`${mi} >> nth=0`, 'ToastMaster');
  await page.fill(`${mi} >> nth=1`, '0.1.0');
  await page.fill(`${mi} >> nth=2`, 'any');
  await page.fill(`${mi} >> nth=3`, 'Roasts your toasts, literally');
  await page.fill('.modal textarea >> nth=0', 'Rates toast darkness 1-10, suggests butter spreads.');
  await page.fill('.modal textarea >> nth=1', 'You are ToastMaster. Judge toast objectively.');
  await page.click('.modal button.primary');
  await page.waitForTimeout(1000);
  await shot("published");
  out.toastInLib = await page.evaluate(() => document.body.innerText.includes('ToastMaster'));

  // open agent detail modal
  await page.click('.acard:has-text("BugHunter")');
  await page.waitForTimeout(600);
  await shot("agentmodal");
  await page.keyboard.press('Escape').catch(() => {});
  await page.click('.shade', { position: { x: 10, y: 10 } }).catch(() => {});
  await page.waitForTimeout(400);

  // share flow: ✦ button on a card → pick channel
  await page.click('.acard:has-text("SousChef") button[title="Share to channel"]');
  await page.waitForTimeout(900);
  await shot("share");
  // click the agent-drops target
  await page.click('.modal .ideopt:has-text("agent-drops")').catch(async () => {
    await page.click('.modal >> text=agent-drops');
  });
  await page.waitForTimeout(700);
  out.shareClosed = await page.evaluate(() => !document.querySelector('.modal'));

  // go to server agent-drops to confirm the share landed
  await page.click('.rail-ico >> nth=1');
  await page.waitForTimeout(900);
  await page.click('text=agent-drops');
  await page.waitForTimeout(800);
  await shot("drops2");
  out.dropText = await page.evaluate(() =>
    document.querySelector('.msgs')?.innerText.slice(-400) || '');

  // send a message live
  await page.fill('.composer textarea', 'hello from QA 🐝');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  out.msgSent = await page.evaluate(() => document.body.innerText.includes('hello from QA'));

  // DM flow: friends → message nova
  await page.click('.rail-ico >> nth=0');
  await page.waitForTimeout(500);
  await page.click('text=Friends');
  await page.waitForTimeout(700);
  await page.click('.frow:has-text("Nova") button:has-text("Message")');
  await page.waitForTimeout(900);
  await shot("dm");
  await page.fill('.composer textarea', 'yo nova, ship BugHunter v3 when?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  out.dmSent = await page.evaluate(() => document.body.innerText.includes('ship BugHunter v3'));

  // settings + light theme
  await page.click('button[title="Settings"]');
  await page.waitForTimeout(500);
  await shot("settings");
  await page.click('.seg button:has-text("Light")');
  await page.waitForTimeout(400);
  await shot("light");
  await page.click('.mfoot button:has-text("Close")');

  out.errors = 'none';
  return out;
}
