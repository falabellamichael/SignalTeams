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
  const py = await page.$('.ws-row:has-text("workspace.py")');
  await py.click();
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const ta = document.querySelector('.ce-ta');
    const pre = document.querySelector('.ce-pre');
    const lh = parseFloat(getComputedStyle(ta).lineHeight);
    // The textarea's scrollHeight tells us how many visual lines it rendered.
    const taVisualLines = Math.round(ta.scrollHeight / lh);
    const preVisualLines = Math.round(pre.getBoundingClientRect().height / lh);
    const sourceLines = ta.value.split("\n").length;
    return {
      sourceLines,
      taVisualLines,
      preVisualLines,
      taWrapped: taVisualLines > sourceLines + 1,
      preWrapped: preVisualLines > sourceLines + 1,
      taScrollH: ta.scrollHeight,
      preH: pre.getBoundingClientRect().height,
      lineHeight: lh,
      taScrollW: ta.scrollWidth,
      taClientW: ta.clientWidth,
    };
  });
}
