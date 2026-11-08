// repro: crash when clicking settings/nav while REMOTE video is live.
// Two tabs on :8075 — mike + nova both join qa-voice with fake cams → real WebRTC.
export default async function (page, ctx) {
  const report = { steps: [] };
  const log = (s) => { report.steps.push(s); console.log('  ' + s); };
  const crashed = [];

  const stubMedia = `
    const fakeVideo = (hue) => {
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

  // page is already loaded — reuse it for mike (tab A)
  await login(page, 'mike');
  log('mike in');

  // pick server, ensure qa-voice channel exists
  const sid = await page.evaluate(async () => {
    const tok = localStorage.getItem('signalteams.token');
    const servers = await (await fetch('/api/servers', { headers: { authorization: 'Bearer ' + tok } })).json();
    return (servers[0] || {}).id;
  });
  await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.rail-ico')];
    (icons.find(e => !(e.getAttribute('title') || '').startsWith('Home') && (e.getAttribute('title') || '')) || icons[1])?.click();
  });
  await new Promise(r => setTimeout(r, 1200));
  const navText = await page.$$eval('.nav-item', els => els.map(e => e.textContent).join('|')).catch(() => '');
  if (!navText.includes('🔊')) {
    await page.evaluate(async (sid) => {
      const tok = localStorage.getItem('signalteams.token');
      await fetch(`/api/servers/${sid}/channels`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
        body: JSON.stringify({ name: 'qa-voice', kind: 'voice' }),
      });
      location.reload();
    }, sid);
    await page.waitForSelector('.rail', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(() => {
      const icons = [...document.querySelectorAll('.rail-ico')];
      (icons.find(e => !(e.getAttribute('title') || '').startsWith('Home') && (e.getAttribute('title') || '')) || icons[1])?.click();
    });
    await new Promise(r => setTimeout(r, 1200));
    log('qa-voice created');
  }

  // nova in a SEPARATE context — same browser, isolated localStorage/cookies
  // so her token doesn't clobber mike's
  const browser = page.context().browser();
  const bctx = await browser.newContext({ locale: 'en-US' });
  const pageB = await bctx.newPage();
  await login(pageB, 'nova');
  log('nova in');
  await pageB.evaluate(() => {
    const icons = [...document.querySelectorAll('.rail-ico')];
    (icons.find(e => !(e.getAttribute('title') || '').startsWith('Home') && (e.getAttribute('title') || '')) || icons[1])?.click();
  });
  await new Promise(r => setTimeout(r, 1200));

  // nova joins qa-voice + cam
  const joinedB = await pageB.evaluate(() => {
    const it = [...document.querySelectorAll('.nav-item')].find(e => (e.textContent || '').includes('🔊'));
    if (it) it.click();
    return !!it;
  });
  log('nova joined voice: ' + joinedB);
  await pageB.waitForSelector('.voice-dock', { timeout: 8000 }).catch(() => log('nova: no dock'));
  await pageB.evaluate(() => document.querySelector('.dock-btn[title*="Camera"]')?.click());
  await new Promise(r => setTimeout(r, 1200));

  // mike joins qa-voice + cam
  const joinedA = await page.evaluate(() => {
    const it = [...document.querySelectorAll('.nav-item')].find(e => (e.textContent || '').includes('🔊'));
    if (it) it.click();
    return !!it;
  });
  log('mike joined voice: ' + joinedA);
  await page.waitForSelector('.voice-dock', { timeout: 8000 }).catch(() => log('mike: no dock'));
  await page.evaluate(() => document.querySelector('.dock-btn[title*="Camera"]')?.click());

  // wait for remote video to negotiate both ways
  await new Promise(r => setTimeout(r, 5000));
  report.videosA = await page.$$eval('video', els => els.length).catch(() => -1);
  report.videosB = await pageB.$$eval('video', els => els.length).catch(() => -1);
  report.errsA1 = await page.evaluate(() => window.__qaErrs || []);
  report.errsB1 = await pageB.evaluate(() => window.__qaErrs || []);
  log(`videos mike=${report.videosA} nova=${report.videosB}`);

  // THE RISKY CLICKS — settings while remote video is live
  await page.evaluate(() => document.querySelector('.me-btn[title="Settings"]')?.click());
  log('mike clicked settings');
  await new Promise(r => setTimeout(r, 2500));
  report.afterSettings = {
    bodyLen: await page.evaluate(() => document.body.innerHTML.length).catch(() => 'CRASHED'),
    errs: await page.evaluate(() => window.__qaErrs || []).catch(() => 'CRASHED'),
  };
  log('after settings: ' + JSON.stringify(report.afterSettings));

  // navigate to a text channel, then to another rail page (Feed)
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 600));
  await page.evaluate(() => {
    const it = [...document.querySelectorAll('.nav-item')].find(e => {
      const t = (e.textContent || '').trim();
      return t.includes('#') && !t.includes('🔊');
    });
    if (it) it.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.querySelector('.rail-ico[title^="Home"]')?.click());
  await new Promise(r => setTimeout(r, 2000));
  report.afterNav = {
    bodyLen: await page.evaluate(() => document.body.innerHTML.length).catch(() => 'CRASHED'),
    errs: await page.evaluate(() => window.__qaErrs || []).catch(() => 'CRASHED'),
    videosStill: await page.$$eval('video', els => els.length).catch(() => -1),
  };
  log('after nav+home: ' + JSON.stringify(report.afterNav));

  report.crashed = crashed;
  report.errsB = await pageB.evaluate(() => window.__qaErrs || []).catch(() => 'CRASHED');
  await page.screenshot({ path: 'qa/shots/crashvid2-mike.png' });
  await pageB.screenshot({ path: 'qa/shots/crashvid2-nova.png' });
  console.log(JSON.stringify(report, null, 2));
}
