import { desk, sleep } from './lib.mjs'
export default async function run(page) {
  await desk(page)
  // login — crew account tab (Supabase box)
  const crew = page.locator('text=crew account').first();
  if (await crew.count()) await crew.click().catch(() => { });
  await page.locator('input').first().fill('mike');
  await page.locator('input[type=password]').first().fill('password');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  // enter first server
  const srv = page.locator('.rail-ico').nth(1);
  await srv.click({ force: true }).catch(() => srv.evaluate(e => e.click()));
  await page.waitForTimeout(2000);

  const out = {};
  // 1. category "+" on the CHAT group header → modal opens preset to chat
  const catGrp = page.locator('.side-group.cat', { hasText: 'chat' }).first();
  out.catAddBtn = await catGrp.locator('button.add').count();
  await catGrp.locator('button.add').click();
  await page.waitForTimeout(700);
  const modal = page.locator('.chan-modal');
  out.modal = await modal.count();
  if (!out.modal) return out;
  const catSel = modal.locator('.cat-ctl select');
  out.catSelect = await catSel.count();
  out.preset = await catSel.inputValue().catch(() => 'n/a');
  out.catOptions = await catSel.locator('option').allTextContents();
  await page.screenshot({ path: 'D:/AgentHive/qa/chan-cat-preset.png' });

  // 2. create a channel under "chat" via the preset
  await modal.locator('input').first().fill('qa-under-chat');
  await modal.locator('.set-foot .primary').click();
  await page.waitForTimeout(1500);
  out.newChanInCat = await page.locator('.side-group.cat', { hasText: 'chat' })
    .locator('xpath=following-sibling::*[1]').count()
    .then(() => page.locator('.nav-item', { hasText: 'qa-under-chat' }).count());
  await page.screenshot({ path: 'D:/AgentHive/qa/chan-cat-created.png' });
  return out;
}
