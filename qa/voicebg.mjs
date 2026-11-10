// verify .voice-stage / .vs-tile video track the theme's --bg/--bg2
export default async function (page, ctx) {
  // crew-account login
  await page.waitForSelector('button, input', { timeout: 15000 });
  const tabs = await page.$$('button');
  for (const t of tabs) {
    const txt = (await t.evaluate(e => e.textContent)).toLowerCase();
    if (txt.includes('crew')) { await t.click(); break; }
  }
  await page.waitForSelector('input', { timeout: 8000 });
  const inputs = await page.$$('input');
  await inputs[0].type('mike');
  await inputs[1].type('password');
  const btns = await page.$$('button[type="submit"], button');
  for (const b of btns) {
    const txt = (await b.evaluate(e => e.textContent)).toLowerCase();
    if (txt.includes('sign') || txt.includes('log') || txt.includes('continue')) { await b.click(); break; }
  }
  await page.waitForSelector('.rail, .sidebar, nav', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 1500));

  // inject a probe stage + tile matching the real markup
  await page.evaluate(() => {
    const stage = document.createElement('div');
    stage.className = 'voice-stage';
    stage.id = 'qa-stage';
    const tile = document.createElement('div');
    tile.className = 'vs-tile';
    const vid = document.createElement('video');
    tile.appendChild(vid);
    stage.appendChild(tile);
    document.body.appendChild(stage);
  });

  const themes = ['dark', 'light', 'daylight', 'obsidian'];
  const out = {};
  for (const t of themes) {
    await page.evaluate(th => {
      document.documentElement.setAttribute('data-theme', th);
      localStorage.setItem('st.theme', th);
    }, t);
    await new Promise(r => setTimeout(r, 120));
    out[t] = await page.evaluate(() => {
      const stage = getComputedStyle(document.getElementById('qa-stage')).backgroundColor;
      const vid = getComputedStyle(document.querySelector('#qa-stage .vs-tile video')).backgroundColor;
      const rs = getComputedStyle(document.documentElement);
      return { stage, tile: vid, bg: rs.getPropertyValue('--bg').trim(), bg2: rs.getPropertyValue('--bg2').trim() };
    });
  }
  await page.evaluate(() => document.getElementById('qa-stage')?.remove());
  // restore dark
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('st.theme', 'dark'); });
  console.log(JSON.stringify(out, null, 2));
}
