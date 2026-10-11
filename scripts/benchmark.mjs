import { performance } from 'node:perf_hooks'
const base = process.argv[2] || 'http://127.0.0.1:3001',
  url = new URL(
    '/api/dashboard?lat=28.6139&lon=77.209&city=New%20Delhi&state=Delhi',
    base,
  )
if (!['127.0.0.1', 'localhost'].includes(url.hostname))
  throw new Error(
    'This check is deliberately local. Approve and configure a separate deployed load test before making cloud latency claims.',
  )
const before = await (await fetch(url)).json()
if (!before.forecast)
  throw new Error('Warm the real forecast cache before benchmarking.')
const timings = [],
  failures = [],
  started = performance.now(),
  jobs = []
for (let index = 0; index < 100; index++) {
  await new Promise((resolve) => setTimeout(resolve, 100))
  jobs.push(
    (async () => {
      const at = performance.now()
      try {
        const reply = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (!reply.ok) throw new Error(`HTTP ${reply.status}`)
        await reply.json()
        timings.push(performance.now() - at)
      } catch (error) {
        failures.push(error.message)
      }
    })(),
  )
}
await Promise.all(jobs)
timings.sort((a, b) => a - b)
console.log(
  JSON.stringify(
    {
      scope:
        'Local cached API, 100 requests paced at 10 per second; not AWS latency or forecast accuracy',
      requests: 100,
      failures: failures.length,
      p50Ms: timings[Math.floor(timings.length * 0.5)],
      p95Ms: timings[Math.floor(timings.length * 0.95)],
      elapsedSeconds: (performance.now() - started) / 1000,
    },
    null,
    2,
  ),
)
