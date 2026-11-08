// repro v3: expand a video tile (StageFocus overlay) THEN click settings/nav
export default async function (page, ctx) {
  const report = { steps: [] };
  const log = (s) => { report.steps.push(s); console.log('  ' + s); };
  const crashed = [];

  const stubMedia = `
    const fakeVideo = () => {
      const cv = document.createElement('canvas');
      cv.width = 640; cv.height = 360;
      const g = cv.getContext('2d');
      setInterval(() => { g.fillStyle = 'hsl(' + (Date.now()/40 % 360) + ',70%,50%)'; g.fillRect(0,0,640,360); }, 40);
      return cv.captureStream(15);
    };
    const fakeAudio = () => {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      return ac.createMediaStreamDestination().stream;
    };
    navigator.mediaDevices.getUserMedia = async (c) => (c && c.video ? fakeVideo() : fakeAudio());
    navigator.mediaDevices.getDisplayMedia = async () => fakeVideo();
    navigator.mediaDevices.enumerateDevices = async () => [];
    window.__qaErrs = [];
    window.addEventListener('error', (e) => window.__qaErrs.push('err: ' + e.message));
    window.addEventListener('unhandledrejection', (e) => window.__qaErrs.push('rej: ' + (e.reason?.message || e.reason)));
  `;

  async function login(p, user) {
    await p.addInitScript(stubMedia);
    p.on('crash', () => crashed.push(user));
    await p.goto('http://127.0.0.1:8075', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('input, .rail', { timeout: 15000 });
    for (const t of await p.$$('button')) {
      if (((await t.evaluate(e => e.textContent)) || '').toLowerCase().includes('crew')) { await t.click(); break; }
    }
    await p.waitForSelector('input', { timeout: 8000 });
    const inputs = await p.$$('input');
    if (inputs.length >= 2) {
      await inputs[0].type(user); await inputs[1].type('password');
      for (const b of await p.$$('button')) {
        const t = ((await b.evaluate(e => e.textContent)) || '').toLowerCase();
        if (t.includes('sign') || t.includes('log') || t.includes('continue')) { await b.click(); break; }
      }
    }
    await p.waitForSelector('.rail', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 1500));
  }
  async function pickServer(p) {
    await p.evaluate(() => {
      const icons = [...document.querySelectorAll('.rail-ico')];
      (icons.find(e => !(e.getAttribute('title') || '').startsWith('Home') && (e.getAttribute('title') || '')) || icons[1])?.click();
    });
    await new Promise(r => setTimeout(r, 1200));
  }
  async function joinVoice(p) {
    return p.evaluate(() => {
      const it = [...document.querySelectorAll('.nav-item')].find(e => (e.textContent || '').includes('🔊'));
      if (it) it.click();
      return !!it;
    });
  }

  await login(page, 'mike');
  await pickServer(page);
  // ensure qa-voice exists
  const navText = await page.$$eval('.nav-item', els => els.map(e => e.textContent).join('|')).catch(() => '');
  if (!navText.includes('🔊')) {
    const sid = await page.evaluate(async () => {
      const tok = localStorage.getItem('signalteams.token');
      const servers = await (await fetch('/api/servers', { headers: { authorization: 'Bearer ' + tok } })).json();
      const sid = (servers[0] || {}).id;
      await fetch(`/api/servers/${sid}/channels`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
        body: JSON.stringify({ name: 'qa-voice', kind: 'voice' }),
      });
      return sid;
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.rail', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    await pickServer(page);
  }

  const browser = page.context().browser();
  const pageB = await (await browser.newContext({ locale: 'en-US' })).newPage();
  await login(pageB, 'nova');
  await pickServer(pageB);
  await joinVoice(pageB);
  await pageB.waitForSelector('.voice-dock', { timeout: 8000 }).catch(() => {});
  await pageB.evaluate(() => document.querySelector('.dock-btn[title*="Camera"]')?.click());
  await new Promise(r => setTimeout(r, 1200));

  await joinVoice(page);
  await page.waitForSelector('.voice-dock', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('.dock-btn[title*="Camera"]')?.click());
  await new Promise(r => setTimeout(r, 5000));
  report.videosA = await page.$$eval('video', els => els.length).catch(() => -1);
  log('mike videos: ' + report.videosA);

  // EXPAND a remote tile (click → StageFocus overlay)
  const expanded = await page.evaluate(() => {
    const t = document.querySelector('.video-tile.zoomable, .vs-tile.zoomable');
    if (t) t.click();
    return !!t;
  });
  await new Promise(r => setTimeout(r, 1500));
  report.focusOpen = await page.$$eval('.vs-focus, .feed-zoom, .fz-stage', els => els.length);
  log('expand clicked: ' + expanded + ' focusOverlay: ' + report.focusOpen);

  // click settings WITH the overlay open
  await page.evaluate(() => document.querySelector('.me-btn[title="Settings"]')?.click());
  await new Promise(r => setTimeout(r, 2500));
  report.afterSettings = {
    bodyLen: await page.evaluate(() => document.body.innerHTML.length).catch(() => 'CRASHED'),
    errs: await page.evaluate(() => window.__qaErrs || []).catch(() => 'CRASHED'),
    modal: await page.$$eval('.modal, [class*="modal"]', els => els.length).catch(() => -1),
  };
  log('after settings w/focus: ' + JSON.stringify(report.afterSettings));

  // Esc everything away → navigate channels → rail home
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => {
    const it = [...document.querySelectorAll('.nav-item')].find(e => (e.textContent || '').includes('#'));
    if (it) it.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.querySelector('.rail-ico[title^="Home"]')?.click());
  await new Promise(r => setTimeout(r, 2000));
  report.afterNav = {
    bodyLen: await page.evaluate(() => document.body.innerHTML.length).catch(() => 'CRASHED'),
    errs: await page.evaluate(() => window.__qaErrs || []).catch(() => 'CRASHED'),
  };
  log('after nav+home: ' + JSON.stringify(report.afterNav));

  // also flip nova's card sel then expand+nav on mike once more
  report.crashed = crashed;
  report.errsB = await pageB.evaluate(() => window.__qaErrs || []).catch(() => 'CRASHED');
  await page.screenshot({ path: 'qa/shots/crashvid3-mike.png' });
  await pageB.screenshot({ path: 'qa/shots/crashvid3-nova.png' });
  console.log(JSON.stringify(report, null, 2));
}
