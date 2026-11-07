export default async function run(page, ui) {
  const out = {};
  await page.waitForTimeout(1000);

  // Switch to crew account tab if present
  const crewBtn = await page.$('button:has-text("crew account")');
  if (crewBtn) {
    await crewBtn.click();
    await page.waitForTimeout(500);
  }

  // fill username + password (mike/password), submit
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(2000);

  // Click on general or a text channel in server
  await page.click('.rail-ico >> nth=1').catch(() => {});
  await page.waitForTimeout(1500);

  // Test 1: @silent autocomplete in composer
  const composer = await page.$('textarea');
  if (composer) {
    await composer.click();
    await composer.type('@sil');
    await page.waitForTimeout(1000);
    out.hasSilentMention = await page.evaluate(() => {
      const el = document.querySelector('.mention-pop');
      return el ? el.innerText : '';
    });
    await page.screenshot({ path: 'D:/AgentHive/qa/qa-silent-mention.png' });
    // clear composer
    await composer.evaluate(e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
  }

  // Test 2: Message context menu & AI action
  const msgs = await page.$$('.msg');
  out.msgCount = msgs.length;
  if (msgs.length > 0) {
    const targetMsg = msgs[msgs.length - 1];
    const box = await targetMsg.boundingBox();
    if (box) {
      // Right-click to open msg-menu
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
      await page.waitForTimeout(1000);
      out.menuText = await page.evaluate(() => {
        const m = document.querySelector('.msg-menu');
        return m ? m.innerText : '';
      });
      await page.screenshot({ path: 'D:/AgentHive/qa/qa-msg-menu.png' });

      // Click on Summarize item
      const clicked = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.msg-menu .mm-item')];
        const sumItem = items.find(i => i.textContent.includes('Summarize'));
        if (sumItem) { sumItem.click(); return true; }
        return false;
      });
      out.summarizeClicked = clicked;

      // Wait for AI response to load in modal (Nexus LLM takes 5-10s)
      await page.waitForTimeout(10000);
      out.modalText = await page.evaluate(() => {
        const m = document.querySelector('.modal');
        return m ? m.innerText : '';
      });
      await page.screenshot({ path: 'D:/AgentHive/qa/qa-ai-modal.png' });
    }
  }

  return out;
}
