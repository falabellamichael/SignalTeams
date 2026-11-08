export default async function run(page, ui) {
  const out = {};
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa-cf-${n}.png` });
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });

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

  // open chat
  await page.click('.ws-tab-add');
  await page.waitForTimeout(2500);
  await shot("chat");

  out.state = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.ws-tab')].map((e) => e.innerText.trim());
    return {
      tabs,
      chatTabCount: tabs.filter((t) => t.replace(/[✕\s]/g, "") === "chat").length,
      addBtn: !!document.querySelector('.ws-tab-add'),
      // how many channel headers are visible?
      headers: [...document.querySelectorAll('.chat-head, .ws-chat-bar, .ch-head')]
        .map((e) => e.innerText.slice(0, 60)),
      hasComposer: !!document.querySelector('.composer'),
      msgsWidth: document.querySelector('.msgs')?.getBoundingClientRect().width,
      chatWidth: document.querySelector('.chat')?.getBoundingClientRect().width,
    };
  });
  return out;
}
