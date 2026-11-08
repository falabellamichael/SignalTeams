export default async function run(page, ui) {
  const out = {};
  await page.waitForTimeout(800);

  const crewBtn = await page.$('button:has-text("crew account")');
  if (crewBtn) { await crewBtn.click(); await page.waitForTimeout(400); }
  await page.fill('input >> nth=0', 'ftest');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1500);

  // open ForumOps server via rail icon title
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.rail-ico')]
      .find((x) => (x.title || '').startsWith('ForumOps'));
    if (el) el.click();
  });
  await page.waitForTimeout(900);

  // click the forum channel in the sidebar
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.nav-item')]
      .find((x) => x.innerText.includes('showcase'));
    if (el) el.click();
  });
  await page.waitForTimeout(900);

  out.forumFeed = await page.evaluate(() => ({
    feed: !!document.querySelector('.forum-feed'),
    cards: document.querySelectorAll('.fpost').length,
    titles: [...document.querySelectorAll('.fpost-title')].map((x) => x.innerText),
    lastBy: [...document.querySelectorAll('.fpost-last')].map((x) => x.innerText),
    composerHidden: !document.querySelector('.composer'),
    forumIcon: !!([...document.querySelectorAll('.ch-hash')].find((x) => x.innerText.includes('📋'))),
  }));

  await page.screenshot({ path: 'D:/AgentHive/qa/qa-forum-feed.png' });

  // open a post → thread panel appears
  const card = await page.$('.fpost');
  if (card) { await card.click(); await page.waitForTimeout(800); }
  out.threadPanel = await page.evaluate(() => ({
    open: !!document.querySelector('.thread-panel'),
    title: document.querySelector('.tp-title')?.innerText || '',
    rootText: document.querySelector('.tp-root-text')?.innerText || '',
  }));

  // reply in thread via panel composer
  const ta = await page.$('.tp-composer textarea');
  if (ta) {
    await ta.fill('adding to the retro');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
  }
  out.replyCount = await page.evaluate(() =>
    document.querySelector('.fpost-meta')?.innerText || '');

  // new post composer
  const np = await page.$('.forum-tools button');
  if (np) {
    await np.click();
    await page.waitForTimeout(400);
    await page.fill('.np-title', 'UI post from QA');
    await page.fill('.newpost textarea', 'created through the composer');
    await page.evaluate(() => {
      [...document.querySelectorAll('.np-foot button')]
        .find((b) => b.innerText === 'Post')?.click();
    });
    await page.waitForTimeout(900);
  }
  out.afterPost = await page.evaluate(() => ({
    cards: document.querySelectorAll('.fpost').length,
    titles: [...document.querySelectorAll('.fpost-title')].map((x) => x.innerText),
  }));
  await page.screenshot({ path: 'D:/AgentHive/qa/qa-forum-after.png' });
  return out;
}
