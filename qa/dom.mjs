export default async function run(page, ui) {
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
  await page.click('.ws-tab-add');
  await page.waitForTimeout(2500);

  return await page.evaluate(() => {
    const tabbar = document.querySelector(".ws-tabbar");
    const body = document.querySelector(".ws-body");
    const side = document.querySelector(".ws-side");
    return {
      tabbarHTML: tabbar?.innerHTML.replace(/\s+/g, " ").slice(0, 600),
      tabCount: tabbar?.children.length,
      bodyClass: body?.className,
      sideExists: !!side,
      sideDisplay: side ? getComputedStyle(side).display : null,
      sideWidth: side ? Math.round(side.getBoundingClientRect().width) : null,
      agentExists: !!document.querySelector(".ws-agent"),
      agentDisplay: document.querySelector(".ws-agent")
        ? getComputedStyle(document.querySelector(".ws-agent")).display : null,
      membersExists: !!document.querySelector(".members"),
      membersWidth: document.querySelector(".members")
        ? Math.round(document.querySelector(".members").getBoundingClientRect().width) : null,
    };
  });
}
