export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  await page.fill('input >> nth=0', 'juno');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.click('.rail-ico[title="Signal HQ"]');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    [...document.querySelectorAll('.side-body .nav-item')]
      .find((c) => c.innerText.includes('show-and-tell'))?.click();
  });
  await page.waitForTimeout(1000);
  // post a formatting showcase message
  await page.evaluate(async () => {
    const t = localStorage.getItem('signalteams.token');
    await fetch('/api/channels/3/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Release notes\n> shipped tonight\n- ~~dice roller~~ dice **dueler**\n- ||hidden prize: a trophy||\n__underlined__ + *italic* done' }) });
  });
  await page.waitForTimeout(1500);
  out.rendered = await page.evaluate(() => ({
    headers: [...document.querySelectorAll('.md-h')].map((x) => x.innerText),
    quotes: [...document.querySelectorAll('.md-quote')].map((x) => x.innerText),
    bullets: [...document.querySelectorAll('.md-ul li')].map((x) => x.innerText.slice(0, 30)),
    spoilers: document.querySelectorAll('.md-spoiler').length,
    strikes: [...document.querySelectorAll('.msg s')].map((x) => x.innerText),
    underlines: [...document.querySelectorAll('.msg u')].map((x) => x.innerText),
  }));
  // spoiler click-to-reveal
  out.spoilerReveal = await page.evaluate(() => {
    const s = document.querySelector('.md-spoiler');
    if (!s) return null;
    const before = getComputedStyle(s).color;
    s.click();
    return { before, after: getComputedStyle(s).color };
  });
  await page.screenshot({ path: 'D:/AgentHive/qa-md.png' });
  return out;
}
