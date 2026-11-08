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

  // home → Agent Library nav item
  const lib = await page.$('.nav-item:has-text("Agent Library")');
  if (!lib) { out.fail = "no library nav"; return out; }
  await lib.click();
  await page.waitForTimeout(1800);
  if (!(await page.$(".library"))) { out.fail = "library view missing"; return out; }

  const seg = await page.$(".library .ftabs .seg");
  out.segRendered = !!seg;
  out.segButtons = seg ? await page.$$eval(".library .ftabs .seg button", (b) =>
    b.map((x) => ({ t: x.innerText.trim(), on: x.classList.contains("on") }))) : null;

  const count = async () =>
    (await page.$$eval(".agent-grid .acard .an", (e) => e.map((x) => x.innerText))).length;

  out.publicCount = await count();
  out.publicNames = await page.$$eval(".agent-grid .acard .an",
    (e) => e.slice(0, 10).map((x) => x.innerText));
  out.trendingShown = !!(await page.$(".trend-strip"));

  // flip to Private — only mike's agents, visibility chips on non-public
  await page.$$eval(".library .ftabs .seg button", (b) => b[1].click());
  await page.waitForTimeout(1400);
  out.privateCount = await count();
  out.visChips = (await page.$$eval(".vis-chip", (e) => e.map((x) => x.innerText))).slice(0, 6);
  out.trendingHidden = !(await page.$(".trend-strip"));
  out.privateOwners = await page.$$eval(".agent-grid .acard .by",
    (e) => [...new Set(e.map((x) => x.innerText.split("·")[0].trim()))]);
  await page.screenshot({ path: "qa/lib-private.png" });

  // flip back — public catalog returns
  await page.$$eval(".library .ftabs .seg button", (b) => b[0].click());
  await page.waitForTimeout(1200);
  out.backToPublic = await count();
  await page.screenshot({ path: "qa/lib-public.png" });
  return out;
}
