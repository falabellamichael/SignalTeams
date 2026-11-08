// verify bot avatars render the flat knot mark (not emoji) across themes
export default async function run(page, ui) {
  const out = {};
  page.on("console", (m) => { if (m.type() === "error") (out.console ||= []).push(m.text()); });
  page.on("pageerror", (e) => (out.pageErrors ||= []).push(String(e)));

  await page.waitForTimeout(900);
  await page.click('.prov-tabs button:has-text("crew account")').catch(() => {});
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(2200);

  // open the first server, hunt channels for a bot-authored message
  await page.locator(".rail-ico").first().click();
  await page.waitForTimeout(1200);
  const chans = page.locator(".nav-item");
  const n = await chans.count();
  let foundChan = null;
  for (let i = 0; i < Math.min(n, 14); i++) {
    await chans.nth(i).click();
    await page.waitForTimeout(800);
    if (await page.locator(".msg .avatar.bot").count()) {
      foundChan = await chans.nth(i).innerText();
      break;
    }
  }
  out.channelWithBot = foundChan;
  out.botAvatars = await page.locator(".msg .avatar.bot").count();
  out.knotsInBots = await page.locator(".avatar.bot .knotmark").count();
  out.emojiLeftInBots = await page.locator(".avatar.bot > span").count();
  out.humanEmojisKept = await page.locator(".avatar:not(.bot) > span").count();

  const el = page.locator(".avatar.bot .knotmark").first();
  out.colorDark = await el.evaluate((e) => getComputedStyle(e).color).catch(() => null);
  try {
    const box = await page.locator(".msg .avatar.bot").first().boundingBox();
    if (box) {
      await page.screenshot({ path: "qa/botav.png", clip: {
        x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 40),
        width: 620, height: 120 } });
    } else await page.screenshot({ path: "qa/botav.png" });
  } catch { await page.screenshot({ path: "qa/botav.png" }); }

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "daylight"));
  await page.waitForTimeout(300);
  out.colorDaylight = await el.evaluate((e) => getComputedStyle(e).color).catch(() => null);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "obsidian"));
  await page.waitForTimeout(300);
  out.colorObsidian = await el.evaluate((e) => getComputedStyle(e).color).catch(() => null);
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  return out;
}
