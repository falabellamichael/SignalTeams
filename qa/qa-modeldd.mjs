export default async function run(page, ui) {
  const shot = (n) => page.screenshot({ path: `D:/AgentHive/qa/qa-modeldd-${n}.png` });
  const out = {};

  await page.waitForTimeout(800);
  await page.click('button:has-text("crew account")').catch(() => {});
  await page.waitForTimeout(300);
  await page.fill('input >> nth=0', 'mike');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary:has-text("Sign in")');
  await page.waitForTimeout(1500);

  // Agent Library → Publish agent (opens PublishModal with the Model field)
  await page.click('text=Agent Library').catch(() => {});
  await page.waitForTimeout(1200);
  await page.click('button:has-text("Publish agent")');
  await page.waitForTimeout(700);
  await shot("publish");
  await page.waitForFunction(
    () => [...document.querySelectorAll('datalist option')].length > 0,
    { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);

  out.modelField = await page.evaluate(() => {
    const inp = [...document.querySelectorAll('input[list]')]
      .find((i) => (i.placeholder || "").includes("pick"));
    if (!inp) return null;
    const dl = document.getElementById(inp.getAttribute("list"));
    return {
      placeholder: inp.placeholder,
      datalistId: inp.getAttribute("list"),
      options: dl ? [...dl.options].map((o) => o.value) : [],
    };
  });

  // focus the field to show the dropdown, then screenshot
  if (out.modelField) {
    await page.click('input[list]').catch(() => {});
    await page.waitForTimeout(400);
    await shot("dropdown");
  }

  out.errors = await page.evaluate(() => window.__errs || []);
  return out;
}
