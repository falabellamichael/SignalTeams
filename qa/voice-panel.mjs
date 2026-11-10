import { desk, sleep } from './lib.mjs'
export default async function run(page) {
  await desk(page)
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  const srv = page.locator('.rail-ico').nth(1);
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(2000);
  // open the voice channel (qa-voice)
  const vc = page.locator('.nav-item', { hasText: 'qa-voice' }).first();
  await vc.click({ force: true }).catch(() => vc.evaluate(e => e.click()));
  await page.waitForTimeout(1500);
  const out = {};
  out.stage = await page.locator('.voice-stage-layout').count();
  out.joinBtn = await page.locator('.join-voice-btn').count();
  out.membersPanel = await page.locator('.members').count();
  await page.screenshot({ path: 'D:/AgentHive/qa/voice-room-1.png' });
  // join voice if the button exists
  if (out.joinBtn) {
    await page.locator('.join-voice-btn').click();
    await page.waitForTimeout(2500);
    out.joined = await page.locator('.voice-dock').count();
    out.membersAfterJoin = await page.locator('.members').count();
    await page.screenshot({ path: 'D:/AgentHive/qa/voice-room-2.png' });
  }
  // open the in-voice text chat drawer
  const chatBtn = page.locator('.stage-top-btn').first();
  if (await chatBtn.count()) {
    await chatBtn.click();
    await page.waitForTimeout(1200);
    out.drawer = await page.locator('.voice-chat-drawer').count();
    out.membersInDrawer = await page.locator('.voice-chat-drawer .members').count();
    out.membersVisible = await page.locator('.voice-chat-drawer .members').first()
      .isVisible().catch(() => false);
    out.voiceBarVisible = await page.locator('.voice-chat-drawer .voice-bar').first()
      .isVisible().catch(() => false);
    // drag the drawer's left-edge grip — width should grow and persist
    const drawer = page.locator('.voice-chat-drawer');
    const box = await drawer.boundingBox();
    out.wBefore = Math.round(box?.width || 0);
    await page.mouse.move(box.x + 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x - 120, box.y + 200, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    out.wAfter = Math.round((await drawer.boundingBox())?.width || 0);
    out.persisted = await page.evaluate(() => localStorage.getItem('st.vchatw'));
    await page.screenshot({ path: 'D:/AgentHive/qa/voice-room-3.png' });
  }
  return out;
}
