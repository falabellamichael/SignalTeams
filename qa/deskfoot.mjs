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
  await page.waitForTimeout(2000);

  await page.click('.rail-ico >> nth=1').catch(() => {});
  await page.waitForTimeout(1200);
  const wsRow = await page.$('.ws-nav');
  if (!wsRow) { out.fail = "no workspace nav"; return out; }
  await wsRow.click();
  await page.waitForTimeout(1800);
  if (!(await page.$('.ws-desk-body'))) { out.fail = "no desk body"; return out; }

  // fat reply to force scrolling, then measure the footer's pin behavior
  out.probe = await page.evaluate(() => {
    const body = document.querySelector(".ws-desk-body");
    const r = document.createElement("div");
    r.className = "ws-reply"; r.id = "probe-reply";
    r.textContent = "filler line\n".repeat(120);
    body.prepend(r);
    const foot = document.querySelector(".ws-desk-foot");
    const cs = foot ? getComputedStyle(foot) : null;
    const res = { foot: !!foot, sticky: cs?.position, bottom: cs?.bottom,
                  marginTop: cs?.marginTop };
    if (!foot) return res;
    // scroll to middle — footer should stay pinned at the region's bottom edge
    body.scrollTop = 600;
    const f = foot.getBoundingClientRect(), b = body.getBoundingClientRect();
    res.mid = { footBottom: Math.round(f.bottom), bodyBottom: Math.round(b.bottom),
                gap: Math.round(b.bottom - f.bottom), scrollTop: body.scrollTop };
    // scroll to very end — footer sits naturally (same place or unpins into flow)
    body.scrollTop = body.scrollHeight;
    const f2 = foot.getBoundingClientRect();
    res.end = { footBottom: Math.round(f2.bottom), bodyBottom: Math.round(b.bottom) };
    // short content — margin-top:auto should still pin it to the bottom
    r.remove();
    const f3 = foot.getBoundingClientRect();
    res.short = { footBottom: Math.round(f3.bottom), bodyBottom: Math.round(b.bottom) };
    return res;
  });

  await page.screenshot({ path: "qa/desk-foot.png" });
  return out;
}
