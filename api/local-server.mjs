import { createServer } from 'node:http'
import { writeFile, readFile, unlink } from 'node:fs/promises'
try {
  process.loadEnvFile()
} catch (error) {
  if (error.code !== 'ENOENT')
    throw new Error(
      'The local environment file cannot be read. Check its permissions and format.',
    )
}
const { handler } = await import('./handler.mjs')
const { setLocalQueue } = await import('./services.mjs')
const { runtime } = await import('./runtime.mjs')
const { deliver } = await import('./notifications.mjs')
const { deliverReview } = await import('./outbox.mjs')
const { evaluateDue } = await import('./alert-dispatcher.mjs')
const { store, engine, context } = await runtime()
let processing = Promise.resolve()
setLocalQueue((job, notification) => {
  processing = processing
    .catch(() => {})
    .then(() => {
      if (notification && job.type === 'review.deliver')
        return deliverReview(job, store, '')
      if (notification && job.type === 'notification')
        return deliver(job, store, '')
      if (job.type === 'refresh') return engine.refresh(job.area)
      if (job.type === 'context.refresh') return context.refresh(job)
      throw new Error('Unknown local job type')
    })
    .catch(() =>
      console.warn(
        'A local background job failed; it will retry on the next refresh.',
      ),
    )
})
const port = Number(process.env.API_PORT || 3001)
const server = createServer(async (request, reply) => {
  try {
    const url = new URL(request.url || '/', 'http://localhost'),
      chunks = []
    let bytes = 0
    for await (const chunk of request) {
      bytes += chunk.length
      if (bytes > 64000) {
        reply.writeHead(413)
        reply.end('Request too large')
        return
      }
      chunks.push(chunk)
    }
    const result = await handler({
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      headers: request.headers,
      body: Buffer.concat(chunks).toString('utf8'),
      requestContext: { http: { method: request.method || 'GET' } },
    })
    reply.writeHead(result.statusCode, result.headers)
    reply.end(result.body)
  } catch {
    reply.writeHead(503, { 'content-type': 'application/json' })
    reply.end(
      JSON.stringify({
        error: 'Local service unavailable. Check its terminal.',
      }),
    )
  }
})
const timer = setInterval(
  () =>
    (async () => {
      await engine.dispatch()
      await context.dispatch()
      await evaluateDue(store, engine)
    })().catch(() => console.warn('Local scheduler failed.')),
  60000,
)
server.listen(port, '127.0.0.1', async () => {
  await writeFile('.airday-local/api.pid', String(process.pid), { mode: 0o600 })
  console.log(`Airday API v2 ready at http://127.0.0.1:${port}`)
})
server.on('error', (error) => {
  console.error('Could not start Airday API:', error.code)
  clearInterval(timer)
  process.exitCode = 1
})
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    clearInterval(timer)
    server.close(async () => {
      try {
        if (
          (await readFile('.airday-local/api.pid', 'utf8')).trim() ===
          String(process.pid)
        )
          await unlink('.airday-local/api.pid')
      } catch {
        /* A stale PID file is checked against the running process by the operator tool. */
      }
      process.exit(0)
    })
  })
