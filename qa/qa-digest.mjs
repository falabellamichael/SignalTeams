export default async function run(page, ui) {
  const out = {};
  await page.waitForTimeout(800);
  const crewBtn = await page.$('button:has-text("crew account")');
  if (crewBtn) { await crewBtn.click(); await page.waitForTimeout(400); }
  await page.fill('input >> nth=0', 'dig');
  await page.fill('input[type="password"]', 'password');
  await page.click('button.primary');
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    [...document.querySelectorAll('.rail-ico')]
      .find((x) => (x.title || '').startsWith('DigSrv'))?.click();
  });
  await page.waitForTimeout(900);

  // open channel edit modal for #ops-feed
  await page.evaluate(() => {
    [...document.querySelectorAll('.nav-item')]
      .find((x) => x.innerText.includes('ops-feed'))?.querySelector('.ch-gear[title="Edit channel"]')?.click();
  });
  await page.waitForTimeout(700);

  out.digestSection = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.modal label, label')].map((x) => x.innerText);
    const hasSection = labels.some((l) => l.includes('Agent digest'));
    const sel = [...document.querySelectorAll('.modal select, select')].map((s) => s.value);
    return { hasSection, selects: sel.length };
  });

  // pick OpsDigest + hourly, Enable
  await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')];
    const agentSel = sels.find((s) => [...s.options].some((o) => o.innerText.includes('OpsDigest')));
    if (agentSel) { agentSel.value = '1'; agentSel.dispatchEvent(new Event('change', { bubbles: true })); }
    const ivSel = sels.find((s) => [...s.options].some((o) => o.innerText === 'hourly'));
    if (ivSel) { ivSel.value = '3600'; ivSel.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.innerText === 'Enable')?.click();
  });
  await page.waitForTimeout(900);
  out.afterEnable = await page.evaluate(() => ({
    hint: [...document.querySelectorAll('.idehint')].map((x) => x.innerText).filter((t) => t.includes('On —')),
    updateBtn: !!([...document.querySelectorAll('button')].find((b) => b.innerText === 'Update')),
  }));
  await page.screenshot({ path: 'D:/AgentHive/qa/qa-digest.png' });
  return out;
}
