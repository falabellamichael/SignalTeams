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

  const desk = await page.$('.ws-agent');
  if (!desk) { out.fail = "no agent desk"; return out; }

  // no box cap anymore + the desk-body is the scroll region
  out.layout = await page.evaluate(() => {
    const reply = document.querySelector(".ws-reply") || (() => {
      const d = document.createElement("div");
      d.className = "ws-reply";
      document.querySelector(".ws-desk-body")?.prepend(d);
      return d;
    })();
    const cs = getComputedStyle(reply);
    const body = document.querySelector(".ws-desk-body");
    return { replyMaxH: cs.maxHeight, replyOverflowY: cs.overflowY,
             bodyOverflowY: body ? getComputedStyle(body).overflowY : null,
             bodyFlex: body ? getComputedStyle(body).flex : null };
  });

  // inject a long reply + confirm the box grows tall and the region scrolls
  out.growth = await page.evaluate(() => {
    const body = document.querySelector(".ws-desk-body");
    const reply = document.querySelector(".ws-reply");
    reply.textContent = "summary line\n".repeat(120);
    return { replyH: reply.offsetHeight, bodyH: body.clientHeight,
             bodyScrollable: body.scrollHeight > body.clientHeight,
             scrollRange: body.scrollHeight - body.clientHeight };
  });

  await page.screenshot({ path: "qa/desk-tall.png" });
  return out;
}
