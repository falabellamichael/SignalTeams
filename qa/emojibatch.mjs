// verify: :emoji: unicode completion, emoji picker search, attachment thumb
export default async function (page, ctx) {
  for (const t of await page.$$('button')) {
    if (((await t.evaluate(e => e.textContent)) || '').toLowerCase().includes('crew')) { await t.click(); break; }
  }
  await page.waitForSelector('input', { timeout: 8000 });
  const inputs = await page.$$('input');
  await inputs[0].type('mike'); await inputs[1].type('password');
  for (const b of await page.$$('button')) {
    const t = ((await b.evaluate(e => e.textContent)) || '').toLowerCase();
    if (t.includes('sign') || t.includes('log') || t.includes('continue')) { await b.click(); break; }
  }
  await page.waitForSelector('.rail', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.rail-ico')];
    (icons.find(e => !(e.getAttribute('title') || '').startsWith('Home') && (e.getAttribute('title') || '')) || icons[1])?.click();
  });
  await page.waitForSelector('.composer textarea', { timeout: 8000 });
  await new Promise(r => setTimeout(r, 1200));

  // 1 · : completion — standard emoji should appear alongside server emoji
  await page.click('.composer textarea');
  await page.keyboard.type(':smi');
  await new Promise(r => setTimeout(r, 900));
  const colonPop = await page.evaluate(() =>
    [...document.querySelectorAll('.mention-pop .mopt')].map(e => e.textContent.trim()));
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 500));
  const afterColon = await page.evaluate(() => document.querySelector('.composer textarea').value);
  await page.evaluate(() => { document.querySelector('.composer textarea').value = ''; });
  // clear via select-all + delete so react state resets
  await page.click('.composer textarea');
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');

  // 2 · emoji picker — open it, search "fire"
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.composer button.ghost')];
    b.find(x => x.getAttribute('title') === 'Emoji')?.click();
  });
  await page.waitForSelector('.emoji-pop', { timeout: 4000 });
  const popInit = await page.evaluate(() => ({
    search: !!document.querySelector('.ep-search'),
    count: document.querySelectorAll('.emoji-pop > span').length,
  }));
  await page.type('.ep-search', 'fire');
  await new Promise(r => setTimeout(r, 500));
  const fireHits = await page.evaluate(() =>
    [...document.querySelectorAll('.emoji-pop > span')].map(e => e.textContent + '|' + (e.getAttribute('title') || '')));
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll('.emoji-pop .ep-head')].map(e => e.textContent));
  // Enter picks first hit
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 400));
  const afterEnter = await page.evaluate(() => document.querySelector('.composer textarea').value);
  // empty-result state
  await page.type('.ep-search', 'zzzzz');
  await new Promise(r => setTimeout(r, 400));
  const noMatch = await page.evaluate(() =>
    [...document.querySelectorAll('.emoji-pop .ep-head')].map(e => e.textContent));

  console.log(JSON.stringify({ colonPop, afterColon, popInit, fireHits, heads, afterEnter, noMatch }, null, 2));
}
