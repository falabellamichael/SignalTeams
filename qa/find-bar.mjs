export default async function run(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  // don't login — reuse whatever state; probe for the wrapped-name element
  await page.reload();
  await page.waitForTimeout(3500);
  return await page.evaluate(() => {
    const bars = document.querySelectorAll('.me-bar');
    const out = { meBarCount: bars.length, bars: [] };
    bars.forEach((b) => {
      const n = b.querySelector('.who .n');
      out.bars.push({
        text: b.innerText.slice(0, 120),
        nText: n?.textContent, nH: n?.getBoundingClientRect().height,
        w: b.getBoundingClientRect().width
      });
    });
    // find any element containing "@MichaelAnthony"
    const all = Array.from(document.querySelectorAll('div,span'))
      .filter(e => e.children.length === 0 && /MichaelAnthony|Michael Anthony/.test(e.textContent));
    out.nameEls = all.slice(0, 5).map(e => {
      const r = e.getBoundingClientRect();
      return {
        cls: e.className, text: e.textContent.slice(0, 60),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)
      };
    });
    out.storedW = localStorage.getItem('st.sidew');
    return out;
  });
}
