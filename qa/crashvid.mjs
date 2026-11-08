// repro: page crash when clicking settings / other pages while video is live
export default async function (page, ctx) {
  const report = { steps: [] };
  const log = (s) => { report.steps.push(s); console.log('  ' + s); };

  // fake media devices BEFORE the app boots
  await page.addInitScript(() => {
    const fakeVideo = () => {
      const cv = document.createElement('canvas');
      cv.width = 640; cv.height = 360;
      const g = cv.getContext('2d');
      setInterval(() => {
        g.fillStyle = `hsl(${Date.now() / 40 % 360},70%,50%)`;
        g.fillRect(0, 0, 640, 360);
      }, 40);
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
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input, .rail', { timeout: 15000 });

  // login (crew account)
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
  log('logged in');

  // select the first server in the rail (lands on Feed view otherwise)
  const sid = await page.evaluate(async () => {
    const tok = localStorage.getItem('signalteams.token');
    const servers = await (await fetch('/api/servers', { headers: { authorization: 'Bearer ' + tok } })).json();
    return (servers[0] || {}).id;
  });
  await page.evaluate(() => {
    const icons = [...document.querySelectorAll('.rail-ico')];
    const srv = icons.find(e => (e.getAttribute('title') || '').length && !(e.getAttribute('title') || '').startsWith('Home'));
    (srv || icons[1])?.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // ensure a voice channel exists on that server
  const navText = await page.$$eval('.nav-item', els => els.map(e => e.textContent).join('|')).catch(() => '');
  if (!navText.includes('🔊')) {
    await page.evaluate(async (sid) => {
      const tok = localStorage.getItem('signalteams.token');
      if (sid) await fetch(`/api/servers/${sid}/channels`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
        body: JSON.stringify({ name: 'qa-voice', kind: 'voice' }),
      });
      location.reload();
    }, sid);
    await page.waitForSelector('.rail', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(() => {
      const icons = [...document.querySelectorAll('.rail-ico')];
      const srv = icons.find(e => (e.getAttribute('title') || '').length && !(e.getAttribute('title') || '').startsWith('Home'));
      (srv || icons[1])?.click();
    });
    await new Promise(r => setTimeout(r, 1500));
    log('created qa-voice channel + reselected server');
  }

  // click the voice channel — auto-joins via Sidebar onClick (evaluate-click:
  // sidebar re-renders on WS events and elementHandle clicks go stale)
  let opened = await page.evaluate(() => {
    const it = [...document.querySelectorAll('.nav-item')].find(e => (e.textContent || '').includes('🔊'));
    if (it) it.click();
    return !!it;
  });
  log('clicked voice nav-item: ' + opened);
  await page.waitForSelector('.voice-dock', { timeout: 10000 }).catch(() => log('no dock'));

  const camOn = await page.evaluate(() => {
    const b = document.querySelector('.dock-btn[title*="Camera"], .dock-btn[title*="camera"]');
    if (b) b.click();
    return !!b;
  });
  log('cam on: ' + camOn);
  await new Promise(r => setTimeout(r, 2500));

  report.videoTiles = await page.$$eval('.video-tile video, .vs-tile video', els => els.length).catch(() => -1);
  report.errs1 = await page.evaluate(() => window.__qaErrs || []);
  log('video tiles live: ' + report.videoTiles + ' errs: ' + JSON.stringify(report.errs1));

  // CLICK SETTINGS while video is live
  const setOk = await page.evaluate(() => {
    const b = document.querySelector('.me-btn[title="Settings"]');
    if (b) b.click();
    return !!b;
  });
  log('clicked settings: ' + setOk);
  await new Promise(r => setTimeout(r, 2500));
  report.afterSettings = {
    bodyLen: await page.evaluate(() => document.body.innerHTML.length),
    errs: await page.evaluate(() => window.__qaErrs || []),
  };
  log('after settings: ' + JSON.stringify(report.afterSettings));

  // close modal → click a text channel
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(() => {
    const it = [...document.querySelectorAll('.nav-item')].find(e => {
      const t = (e.textContent || '').trim();
      return t.includes('#') && !t.includes('🔊');
    });
    if (it) it.click();
  });
  await new Promise(r => setTimeout(r, 2500));
  report.afterNav = {
    bodyLen: await page.evaluate(() => document.body.innerHTML.length),
    errs: await page.evaluate(() => window.__qaErrs || []),
    videosStill: await page.$$eval('video', els => els.length).catch(() => -1),
  };
  log('after nav: ' + JSON.stringify(report.afterNav));

  await page.screenshot({ path: 'qa/shots/crashvid.png' });
  console.log(JSON.stringify(report, null, 2));
}
