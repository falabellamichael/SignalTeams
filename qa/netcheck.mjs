import { desk, sleep } from './lib.mjs'
export default async function run(page, ui) {
  await desk(page)
  return await page.evaluate(() => {
    const mods = performance.getEntriesByType('resource')
      .filter((r) => r.name.includes('/src/'))
      .map((r) => r.name.split('?')[0].split('/src/')[1])
    return {
      voiceFetched: mods.filter((m) => m.includes('voice')),
      total: mods.length,
      sample: mods.slice(-15),
    }
  })
}
