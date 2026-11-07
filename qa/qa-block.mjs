export default async function run(page, ui) {
  const out = {};
  page.on('dialog', (d) => d.accept());
  const login = async () => {
    const hasToken = await page.evaluate(() => !!localStorage.getItem('signalteams.token'));
    if (!hasToken) {
      await page.waitForSelector('input', { timeout: 25000 });
      await page.fill('input >> nth=0', 'mike');
      await page.fill('input[type="password"]', 'password');
      await page.click('button.primary');
    }
    await page.waitForSelector('.rail-ico', { timeout: 25000 });
    await page.waitForTimeout(1800);
  };
  const openGeneral = async () => {
    await page.evaluate(() =>
      [...document.querySelectorAll('.rail-ico')].find((i) => i.title?.includes('Signal HQ'))?.click());
    await page.waitForTimeout(1600);
    await page.evaluate(() =>
      [...document.querySelectorAll('.nav-item .txt')]
        .find((t) => t.innerText.trim() === 'general')?.closest('.nav-item')?.click());
    await page.waitForTimeout(1400);
  };
  await login();
  await openGeneral();
  out.inChannel = await page.evaluate(() =>
    document.querySelector('.topbar, .composer') ? true : document.body.innerText.slice(0, 120));

  // --- 1. emoji picker ---
  await page.click('button[title="Emoji"]');
  await page.waitForTimeout(500);
  out.pickerOpen = await page.evaluate(() => !!document.querySelector('.emoji-pop'));
  out.pickerCount = await page.evaluate(() => document.querySelectorAll('.emoji-pop span').length);
  await page.evaluate(() => [...document.querySelectorAll('.emoji-pop span')][3]?.click());
  await page.waitForTimeout(300);
  out.draftAfterPick = await page.evaluate(() =>
    document.querySelector('.composer textarea')?.value);
  await page.evaluate(() => [...document.querySelectorAll('.emoji-pop span')][10]?.click());
  await page.waitForTimeout(200);
  out.draftAfterPick2 = await page.evaluate(() =>
    document.querySelector('.composer textarea')?.value);
  await page.screenshot({ path: 'D:/AgentHive/qa-emoji.png' });
  await page.click('button[title="Emoji"]');
  await page.waitForTimeout(250);
  out.pickerClosed = await page.evaluate(() => !document.querySelector('.emoji-pop'));
  // clear draft
  await page.evaluate(() => {
    const t = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // --- 2. block nova via API, nova posts, reload, collapse check ---
  await page.evaluate(async () => {
    const t = localStorage.getItem('signalteams.token');
    const h = { Authorization: 'Bearer ' + t };
    const cur = await fetch('/api/blocks', { headers: h }).then((r) => r.json());
    if (!cur.includes(2)) await fetch('/api/blocks/2', { method: 'POST', headers: h });
    const lr = await fetch('/api/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nova', password: 'password' }) });
    const nt = (await lr.json()).token;
    await fetch('/api/channels/1/messages', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + nt },
      body: JSON.stringify({ content: 'secret nova transmission' }) });
  });
  await page.reload();
  await login();
  await openGeneral();
  out.blockedRows = await page.evaluate(() =>
    [...document.querySelectorAll('.blocked-msg .blocked-line')].map((l) => l.innerText));
  await page.screenshot({ path: 'D:/AgentHive/qa-blocked.png' });
  const before = await page.evaluate(() => document.querySelectorAll('.blocked-msg').length);
  await page.evaluate(() =>
    [...document.querySelectorAll('.blocked-msg')].at(-1)?.click());
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => document.querySelectorAll('.blocked-msg').length);
  out.reveal = { before, after };
  out.revealedContent = await page.evaluate(() =>
    document.body.innerText.includes('secret nova transmission'));

  // --- 3. profile modal block button ---
  await page.evaluate(async () => {
    const t = localStorage.getItem('signalteams.token');
    const h = { Authorization: 'Bearer ' + t };
    const cur = await fetch('/api/blocks', { headers: h }).then((r) => r.json());
    if (cur.includes(2)) await fetch('/api/blocks/2', { method: 'POST', headers: h });
  });
  await page.reload();
  await login();
  await openGeneral();
  await page.evaluate(() =>
    [...document.querySelectorAll('.members .mrow')]
      .find((n) => n.innerText.includes('Nova'))?.click());
  await page.waitForTimeout(900);
  out.modalOpen = await page.evaluate(() => !!document.querySelector('.modal-backdrop, .modal'));
  out.profileBlockBtn = await page.evaluate(() =>
    [...document.querySelectorAll('.blockbtn')].map((b) => b.innerText));
  await page.screenshot({ path: 'D:/AgentHive/qa-profile-block.png' });

  // --- 4. Friends blocked tab ---
  // block via the modal button for a full-UI loop
  out.modalBtns = await page.evaluate(() =>
    [...document.querySelectorAll('.modal button, .modal-backdrop button')].map((b) => b.innerText.trim()));
  const blk = await page.evaluate(() =>
    [...document.querySelectorAll('.blockbtn')].find((b) => b.innerText.includes('Block'))?.click());
  await page.waitForTimeout(500);
  out.blockedListAfterModal = await page.evaluate(async () => {
    const t = localStorage.getItem('signalteams.token');
    return fetch('/api/blocks', { headers: { Authorization: 'Bearer ' + t } }).then((r) => r.json());
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // go home → Friends
  await page.evaluate(() => document.querySelector('.rail-ico')?.click());
  await page.waitForTimeout(900);
  await page.evaluate(() =>
    [...document.querySelectorAll('.nav-item .txt, .sb-item .txt')]
      .find((t) => t.innerText.trim() === 'Friends')?.closest('.nav-item, .sb-item')?.click());
  await page.waitForTimeout(1400);
  out.friendsTabs = await page.evaluate(() =>
    [...document.querySelectorAll('.ftab')].map((t) => t.innerText));
  await page.evaluate(() =>
    [...document.querySelectorAll('.ftab')].find((t) => t.innerText.includes('Blocked'))?.click());
  await page.waitForTimeout(900);
  out.blockedTabRows = await page.evaluate(() =>
    [...document.querySelectorAll('.frow .who .n')].map((n) => n.innerText));
  out.unblockBtns = await page.evaluate(() =>
    [...document.querySelectorAll('.frow .acts button')].map((b) => b.innerText));
  await page.screenshot({ path: 'D:/AgentHive/qa-blocked-tab.png' });
  // cleanup: unblock from the Friends row for a full loop
  await page.evaluate(() =>
    [...document.querySelectorAll('.frow .acts button')].find((b) => b.innerText === 'Unblock')?.click());
  await page.waitForTimeout(600);
  out.finalBlocks = await page.evaluate(async () => {
    const t = localStorage.getItem('signalteams.token');
    return fetch('/api/blocks', { headers: { Authorization: 'Bearer ' + t } }).then((r) => r.json());
  });
  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
