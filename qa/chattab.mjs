export default async function run(page, ui) {
  const out = {};
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-ct-${n}.png` });
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });
  page.on("pageerror", (e) => (out.pageErrors ||= []).push(String(e)));

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

  // 1. open a file first
  const py = await page.$('.ws-row:has-text("workspace.py")');
  if (py) { await py.click(); await page.waitForTimeout(1200); }
  out.afterFile = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.ws-tab')].map((e) => e.innerText.trim()),
    hasChatBtn: !!document.querySelector('.ws-tab-add'),
  }));

  // 2. click the "+ chat" tab button
  await page.click('.ws-tab-add');
  await page.waitForTimeout(2500);
  await shot("chat");
  out.afterChat = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.ws-tab')].map((e) => e.innerText.trim()),
    chatBar: document.querySelector('.ws-chat-bar')?.innerText,
    hasComposer: !!document.querySelector('.composer'),
    hasMsgs: !!document.querySelector('.msgs'),
  }));

  // 3. switch back to the file tab
  const fileTab = await page.$('.ws-tab:not(.chat):not(.ws-tab-add)');
  if (fileTab) { await fileTab.click(); await page.waitForTimeout(900); }
  out.backToFile = await page.evaluate(() => ({
    hasEditor: !!document.querySelector('.ce-ta'),
    activeTab: document.querySelector('.ws-tab.on')?.innerText.trim(),
  }));
  await shot("file");

  // 4. back to chat, verify it persisted
  await page.click('.ws-tab.chat');
  await page.waitForTimeout(1200);
  out.chatAgain = await page.evaluate(() => ({
    hasComposer: !!document.querySelector('.composer'),
    activeTab: document.querySelector('.ws-tab.on')?.innerText.trim(),
  }));

  // 5. close the chat tab
  await page.click('.ws-tab.chat .ws-tab-x');
  await page.waitForTimeout(800);
  out.afterClose = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.ws-tab')].map((e) => e.innerText.trim()),
    hasChat: !!document.querySelector('.ws-chat-bar'),
  }));

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
