export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  if (await page.evaluate(() => [...document.querySelectorAll('input[type="password"]')].length > 0)) {
    await page.fill('input >> nth=0', 'mike');
    await page.fill('input[type="password"]', 'password');
    await page.click('button.primary');
  }
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title === 'Signal HQ')?.click());
  await page.waitForTimeout(1500);
  // open #starboard
  await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')]
      .find((t) => t.innerText.trim() === 'starboard')?.closest('.nav-item')?.click());
  await page.waitForTimeout(1200);
  out.board = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('.msg')];
    return msgs.map((m) => ({
      who: m.querySelector('.who')?.innerText,
      text: m.querySelector('.text')?.innerText,
      fwd: m.querySelector('.fwd-tag')?.innerText,
    })).filter((x) => x.fwd || x.text?.includes('⭐'));
  });
  // check star quick-react exists on a message hover + settings field
  await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')]
      .find((t) => t.innerText.trim() === 'general')?.closest('.nav-item')?.click());
  await page.waitForTimeout(1200);
  out.quickStar = await page.evaluate(() => {
    // react row uses QUICK — check the emoji picker has ⭐ in quick row… simpler: check ctxmenu
    const msg = [...document.querySelectorAll('.msg')].at(-1);
    if (!msg) return null;
    msg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    return 'ctx-opened';
  });
  await page.waitForTimeout(400);
  out.ctxReacts = await page.evaluate(() =>
    [...document.querySelectorAll('.ctx-react, .qreact, [class*="react"] span')]
      .map((x) => x.innerText).filter(Boolean));
  out.settings = await page.evaluate(async () => {
    // open server settings
    [...document.querySelectorAll('.gear, [title*="ettings"], .srv-head .txt')]
      .forEach((x) => x.click());
    return 'clicked';
  });
  await page.waitForTimeout(600);
  out.threshField = await page.evaluate(() => {
    const lbl = [...document.querySelectorAll('label')].find((l) => l.innerText.includes('Starboard'));
    const inp = lbl?.parentElement?.querySelector('input[type="number"]');
    return inp ? { label: lbl.innerText.slice(0, 40), value: inp.value } : null;
  });
  return out;
}
