export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa/qa-chatsplit-${n}.png` });
  const out = {};

  await page.waitForTimeout(800);
  await page.click('button:has-text("crew account")').catch(() => {});
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary:has-text("Sign in")');
  await page.waitForTimeout(1500);

  await page.click('.rail-ico >> nth=1').catch(() => {});
  await page.waitForTimeout(1200);
  await shot("channel");
  out.msgs = await page.evaluate(() => document.querySelectorAll('.msg, .msgrow').length);
  out.composer = await page.evaluate(() => !!document.querySelector('textarea, input[placeholder^="Message"]'));

  await page.fill('textarea, input[placeholder^="Message"]', 'chat-split QA ping');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  out.sent = await page.evaluate(() => document.body.innerText.includes('chat-split QA ping'));

  // thread: click the thread/reply affordance on last message if present
  const msg = page.locator('.msg, .msgrow').last();
  await msg.hover().catch(() => {});
  await shot("hover");
  const tbtn = page.locator('button[title*="hread"], button[title*="eply"]').first();
  if (await tbtn.count()) { await tbtn.click().catch(() => {}); }
  await page.waitForTimeout(500);
  out.threadPanel = await page.evaluate(() => !!document.querySelector('.thread, .side-thread'));

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
