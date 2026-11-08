export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-wschat-${n}.png` });
  const out = {};
  await page.waitForTimeout(900);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => { });
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1800);
  await page.click('.rail-ico >> nth=1').catch(() => { });
  await page.waitForTimeout(1500);
  await page.click('.ws-nav').catch(() => { });
  await page.waitForTimeout(1800);

  // Studio is the default view — agent panel + drag handle + toggle present
  out.studio = {
    agent: await page.locator('.ws-agent').count(),
    drag: await page.locator('.ws-drag').count(),
    toggle: await page.locator('.ws-view').count(),
  };
  const w0 = await page.locator('.ws-agent').boundingBox();
  out.panelW0 = Math.round(w0?.width || 0);

  // drag the resizer ~120px wider (handle is on the panel's left edge)
  const d = await page.locator('.ws-drag').boundingBox();
  await page.mouse.move(d.x + 3, d.y + 200);
  await page.mouse.down();
  await page.mouse.move(d.x - 120, d.y + 200, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const w1 = await page.locator('.ws-agent').boundingBox();
  out.panelW1 = Math.round(w1?.width || 0);
  out.persist = await page.evaluate(() => localStorage.getItem('st.wspanel'));
  await shot('studio-wide');

  // switch to Chat — full ChatView mounts inside the workspace
  await page.click('.ws-view button:has-text("chat")');
  await page.waitForSelector('.chat .composer', { timeout: 10000 });
  await page.waitForTimeout(1500);
  out.chat = {
    msgs: await page.locator('.msgs .msg').count(),
    composer: await page.locator('.composer textarea').count(),
    members: await page.locator('.members').count(),
  };
  await shot('chat');

  // post a message — lands in the shared channel
  await page.fill('.composer textarea', 'workspace chat live test');
  await page.press('.composer textarea', 'Enter');
  await page.waitForTimeout(800);
  const lastText = await page.locator('.msgs .msg .text').last().innerText().catch(() => '');
  out.sentOk = lastText.includes('live test');

  // @-mention autocomplete offers agents
  await page.fill('.composer textarea', '@Bug');
  await page.waitForTimeout(500);
  out.mentionPop = await page.locator('.mention-pop .mopt').count();
  await shot('chat-mention');
  await page.fill('.composer textarea', '');

  // the backing channel shows up in the sidebar under Agent channels (🗂 icon)
  out.sideWsChan = await page.locator('.nav-item:has-text("agenthive-core")').count();

  // back to Studio — toggle round-trips
  await page.click('.ws-view button:has-text("studio")');
  await page.waitForTimeout(800);
  out.backToStudio = await page.locator('.ws-side').count();
  return out;
}
