import assert from 'node:assert/strict'
import test from 'node:test'
import { handler, response } from '../api/handler.mjs'
test('API security headers allow only the configured origin and never wildcard CORS', () => {
  const good = response(
      200,
      { ok: true },
      process.env.ALLOWED_ORIGIN || 'http://localhost:5174',
    ),
    bad = response(200, {}, 'https://untrusted.example')
  assert.notEqual(good.headers['access-control-allow-origin'], '*')
  assert.equal(bad.headers['access-control-allow-origin'], undefined)
  assert.equal(good.headers['x-content-type-options'], 'nosniff')
  assert.equal(good.headers['cache-control'], 'no-store')
})
test('health/config contain no provider credentials and advertise no sample substitution', async () => {
  const health = JSON.parse(
    (await handler({ rawPath: '/api/health', headers: {} })).body,
  )
  assert.equal(health.fixtures, false)
  assert.equal(health.version, 2)
  const config = JSON.parse(
    (await handler({ rawPath: '/api/config', headers: {} })).body,
  )
  assert.ok(!Object.keys(config).some((key) => /secret|api.?key/i.test(key)))
})
test('invalid coordinates and dates are rejected before any provider work', async () => {
  for (const query of [
    'lat=0&lon=0',
    'lat=28.6&lon=77.2&date=2026-02-30',
    'lat=28.6&lon=77.2&date=2100-01-01',
  ]) {
    const result = await handler({
      rawPath: '/api/dashboard',
      rawQueryString: query,
      headers: {},
    })
    assert.equal(result.statusCode, 400)
  }
})
