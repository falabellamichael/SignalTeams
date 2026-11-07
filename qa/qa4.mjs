export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-${n}.png` });
  const out = {};
  await page.waitForTimeout(600);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1200);

  await page.click('text=Agent Library');
  await page.waitForTimeout(800);
  await page.click('.acard:has-text("SousChef")');
  await page.waitForTimeout(600);

  // Try it tab
  await page.click('.ftab:has-text("Try it")');
  await page.waitForTimeout(500);
  await shot("trytab");
  out.providerNote = await page.evaluate(() =>
    document.querySelector('.lib-tools span')?.textContent || '');
  await page.fill('.pchat + .composer textarea, .modal .composer textarea', 'I have eggs, rice, and a sad onion.');
  await page.keyboard.press('Enter');
  // llama3 can take a while
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const done = await page.evaluate(() => !!document.querySelector('.pmsg.assistant .pmeta'));
    if (done) break;
    await page.waitForTimeout(1500);
  }
  out.reply = await page.evaluate(() =>
    document.querySelector('.pmsg.assistant .ptext')?.textContent?.slice(0, 160) || 'NO REPLY');
  await shot("tryreply");

  // Reviews tab
  await page.click('.ftab:has-text("Reviews")');
  await page.waitForTimeout(400);
  await page.click('.rate-star >> nth=4');   // 5 stars
  await page.fill('.modal textarea', 'This thing made my fridge feel seen.');
  await page.click('button:has-text("Post review")');
  await page.waitForTimeout(800);
  out.reviewPosted = await page.evaluate(() => document.body.innerText.includes('feel seen'));
  await shot("reviews");

  return out;
}
