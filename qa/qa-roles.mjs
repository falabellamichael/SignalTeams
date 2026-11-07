export default async function run(page, ui) {
  const out = {};
  await page.waitForSelector('input', { timeout: 25000 });
  const hasLogin = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="password"]')].length > 0);
  if (hasLogin) {
    await page.fill('input >> nth=0', 'mike');
    await page.fill('input[type="password"]', 'password');
    await page.click('button.primary');
  }
  await page.waitForSelector('.rail-ico', { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.rail-ico')].find((i) => i.title === 'Signal HQ')?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt')]
      .find((t) => t.innerText.trim() === 'general')?.closest('.nav-item')?.click());
  await page.waitForTimeout(1200);

  // member column: nova should carry the mods pill + blue name
  out.memberRows = await page.evaluate(() =>
    [...document.querySelectorAll('.mrow')].map((r) => ({
      name: r.querySelector('.n')?.innerText,
      color: r.querySelector('.n')?.style.color || null,
      pills: [...r.querySelectorAll('.role-pill')].map((p) => p.innerText),
    })).filter((r) => r.pills.length || r.color));

  // message author colors — any nova-authored msg should be blue
  out.authorColors = await page.evaluate(() =>
    [...document.querySelectorAll('.msg .author')].map((a) => ({
      name: a.innerText, color: a.style.color,
    })).filter((a) => a.color && a.color !== ''));

  // server settings → Roles section
  await page.evaluate(() =>
    document.querySelector('.rail-ico')?.parentElement
      ?.querySelector('.srv-gear, [title*="ettings"]')?.click());
  await page.waitForTimeout(300);
  await page.evaluate(() =>
    [...document.querySelectorAll('button, .ghost, [title]')]
      .find((b) => b.title && b.title.toLowerCase().includes('settings'))?.click());
  await page.waitForTimeout(800);
  out.settings = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('label')].map((l) => l.innerText);
    const pills = [...document.querySelectorAll('.role-list .role-pill.big')].map((p) => p.innerText.trim());
    const chips = document.querySelectorAll('.role-chips .role-pill').length;
    const onChips = [...document.querySelectorAll('.role-chips .role-pill.on')].map((p) => p.innerText);
    const sws = document.querySelectorAll('.role-sw').length;
    return { labels: labels.slice(0, 8), pills, chips, onChips, sws };
  });
  return out;
}
