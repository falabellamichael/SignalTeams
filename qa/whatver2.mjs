import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  return await page.evaluate(async () => {
    const res = performance.getEntriesByType('resource')
      .filter((r) => r.name.includes('/assets/index-'))
      .map((r) => ({ n: r.name.split('/').pop(), bytes: r.transferSize, enc: r.encodedBodySize }))
    const mods = res.slice(0, 10)
    // is the main module's content actually the new one? probe a marker via dynamic import count
    let vsAfter = 'skip'
    try { const v = await import('/assets/index-C3T2m_Nz.js'); vsAfter = typeof window.__voiceState } catch (e) { vsAfter = 'importerr ' + e }
    return { mods, vs: typeof window.__voiceState, vsAfter }
  })
}
