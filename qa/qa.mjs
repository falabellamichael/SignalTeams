export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};

  // login screen
  await page.waitForTimeout(800);
  await shot("login");
  let snap = await ui.snapshot();

  // fill username + password (mike/password), submit
  const inputs = snap.match(/@(e\d+) textbox/g) || [];
  out.loginSnap = snap.slice(0, 1500);
  const userRef = snap.match(/@(e\d+) textbox/)?.[1];
  const passRef = snap.match(/@(e\d+) textbox,.*password|@(e\d+) textbox "Password"/i)?.[1]
    || snap.match(/@(e\d+) (?:textbox|input)[^\n]*[Pp]assword/)?.[1];
  // fallback: fill by placeholder/label
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1500);
  await shot("home");
  out.homeText = await page.evaluate(() => document.body.innerText.slice(0, 800));

  // go to library
  await page.click('text=Agent Library').catch(() => {});
  await page.waitForTimeout(1000);
  await shot("library");

  // buzz
  await page.click('text=Buzz').catch(() => {});
  await page.waitForTimeout(800);
  await shot("buzz");

  // server: click hive icon (rail icon after bee)
  await page.click('.rail-ico >> nth=1').catch(() => {});
  await page.waitForTimeout(1200);
  await shot("server");

  // agent-drops channel
  await page.click('text=agent-drops').catch(() => {});
  await page.waitForTimeout(800);
  await shot("drops");

  // friends
  await page.click('.rail-ico >> nth=0');
  await page.waitForTimeout(500);
  await page.click('text=Friends');
  await page.waitForTimeout(800);
  await shot("friends");

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
