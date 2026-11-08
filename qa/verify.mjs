export default async function run(page, ui) {
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
  const py = await page.$('.ws-row:has-text("workspace.py")');
  await py.click();
  await page.waitForTimeout(1500);

  // scroll to 0 and read what the first visible line actually says
  out.atZero = await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    ta.scrollLeft = 0; ta.scrollTop = 0;
    ta.dispatchEvent(new Event("scroll"));
    const pre = document.querySelector(".ce-pre");
    const taRect = ta.getBoundingClientRect();
    // find the first text node and measure its left edge
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    const tn = walker.nextNode();
    const r = document.createRange();
    r.setStart(tn, 0); r.setEnd(tn, 1);
    const g = r.getBoundingClientRect();
    return {
      firstText: tn.textContent.slice(0, 70),
      glyphX: g.left,
      taLeft: taRect.left,
      offset: g.left - taRect.left,
      // what the textarea's own first line says
      taFirstLine: ta.value.split("\n")[0].slice(0, 70),
    };
  });
  await page.screenshot({ path: "D:/AgentHive/qa-ed-verify.png" });
  return out;
}
