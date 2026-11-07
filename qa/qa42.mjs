export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(1200);
  // type markdown into composer, toggle preview
  const ta = page.locator('textarea').last();
  await ta.fill('# big idea\n> quote me\n- one\n- two\n**bold** ||secret||');
  await page.locator('button[title="Preview markdown"]').click();
  await page.waitForTimeout(600);
  out.preview = await page.evaluate(() => ({
    exists: !!document.querySelector('.md-preview'),
    h: document.querySelector('.md-preview .md-h')?.innerText,
    bullets: document.querySelectorAll('.md-preview .md-ul li').length,
    spoiler: document.querySelectorAll('.md-preview .md-spoiler').length,
  }));
  await page.screenshot({ path: 'D:/AgentHive/qa-preview.png' });
  // off again
  await page.locator('button[title="Preview markdown"]').click();
  await page.waitForTimeout(300);
  out.closed = await page.evaluate(() => !document.querySelector('.md-preview'));
  out.draftStillThere = await ta.inputValue();
  return out;
}
