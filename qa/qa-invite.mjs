export default async function run(page, ui) {
  const out = {};
  // new user hits the join link (fresh session — no token)
  await page.goto('http://localhost:5175/#join/signal-demo');
  await page.waitForSelector('.login-card', { timeout: 25000 });
  await page.waitForTimeout(1200);
  out.banner = await page.evaluate(() =>
    document.querySelector('.join-banner')?.innerText);
  out.defaultMode = await page.evaluate(() =>
    document.querySelector('.login-card h2')?.innerText);
  await page.screenshot({ path: 'D:/AgentHive/qa-invite.png' });

  // register through the banner flow
  const uname = 'recruit' + Math.floor(Math.random() * 9000);
  await page.fill('input >> nth=0', uname);
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(2500);
  out.hashCleared = await page.evaluate(() => location.hash);
  out.railIcons = await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].map((i) => i.title));
  out.activeServer = await page.evaluate(() =>
    document.querySelector('.rail-ico.on')?.title);
  out.sidebarServer = await page.evaluate(() =>
    document.querySelector('.sb-head, .sidebar h2, .srv-name')?.innerText
      || document.body.innerText.slice(0, 160));
  await page.screenshot({ path: 'D:/AgentHive/qa-invite-landed.png' });

  // already-a-member user hits the same link → lands in server too
  await page.evaluate(() => localStorage.clear());
  await page.goto('http://localhost:5175/?r=2#join/signal-demo');
  await page.waitForSelector('.login-card', { timeout: 25000 });
  await page.waitForTimeout(800);
  await page.evaluate(() =>
    [...document.querySelectorAll('.login-card .swap a')][0]?.click()); // switch to login
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'juno');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(2200);
  out.memberReland = await page.evaluate(() =>
    document.querySelector('.rail-ico.on')?.title);
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
