import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { evaluate } from '../api/evaluation.mjs'
const args = process.argv.slice(2),
  option = (name) => args[args.indexOf(name) + 1]
if (
  !args.includes('--input') ||
  !args.includes('--cutoff') ||
  !args.includes('--threshold')
) {
  console.log(
    'node scripts/evaluate.mjs --input .airday-local/archives --cutoff 2026-11-01T00:00:00+05:30 --threshold 75 [--output .airday-local/evaluation.json]',
  )
  process.exit(0)
}
const forecasts = [],
  observations = []
let files = 0
async function walk(path) {
  if ((await stat(path)).isDirectory()) {
    for (const name of await readdir(path)) await walk(join(path, name))
    return
  }
  if (!/\.json(?:\.gz)?$/.test(path)) return
  if (++files > 5000 || (await stat(path)).size > 10000000)
    throw new Error('Evaluation input exceeds the local processing bound.')
  const data = await readFile(path),
    body = JSON.parse(
      path.endsWith('.gz')
        ? gunzipSync(data, { maxOutputLength: 20000000 }).toString('utf8')
        : data.toString('utf8'),
    )
  if (body.kind === 'forecast' && body.normalized)
    forecasts.push(body.normalized)
  if (body.kind === 'observation' && Array.isArray(body.records))
    observations.push(...body.records)
}
await walk(resolve(option('--input')))
const report = evaluate(forecasts, observations, {
  threshold: Number(option('--threshold')),
  cutoff: option('--cutoff'),
})
if (args.includes('--output'))
  await writeFile(
    resolve(option('--output')),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  )
console.log(JSON.stringify({ ...report, pairs: undefined }, null, 2))
