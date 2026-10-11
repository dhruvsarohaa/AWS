import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ApiError,
  areaFor,
  comparable,
  concentration,
  finite,
  hash,
  sourceAge,
  timestamp,
  unit,
  validDate,
  validateForecast,
} from '../api/core.mjs'
import {
  normalizeCpcb,
  normalizeOpenAq,
  fetchOpenAq,
  reconcileOpenAq,
} from '../api/providers.mjs'
import { MemoryStore, FileStore, DynamoStore } from '../api/store.mjs'
import { makeTransport, quota } from '../api/transport.mjs'
import { createEngine } from '../api/engine.mjs'
import { indexStations, nearbyStations } from '../api/spatial.mjs'
import { policyFor } from '../api/policies.mjs'
import {
  place,
  rawForecast,
  location,
  sensor,
  latest,
  hourly,
} from './fixtures.mjs'

test('contract rejects null, boolean, blank, negative and invalid values; zero survives', () => {
  for (const value of [null, undefined, '', false, true, [], {}, Infinity])
    assert.equal(finite(value), null)
  assert.equal(concentration(-1), null)
  assert.equal(concentration(0), 0)
  assert.equal(finite(' 42 '), 42)
})
test('units and dates must be verified; impossible dates and timezone-free times fail', () => {
  assert.equal(unit('μg/m³'), 'µg/m³')
  assert.equal(unit('ppm'), null)
  assert.equal(unit(null), null)
  assert.equal(validDate('2026-02-30'), false)
  assert.equal(timestamp('2026-02-30T10:00:00Z'), null)
  assert.equal(timestamp('2026-10-08T10:00'), null)
})
test('forecast grid/units are validated and content identity ignores retrieval time', () => {
  const first = validateForecast(rawForecast(), 1),
    second = validateForecast(rawForecast(), 2)
  assert.equal(first.id, second.id)
  assert.notEqual(first.fetchedAt, second.fetchedAt)
  assert.equal(first.issuedAt, null)
  assert.equal(first.spatialResolutionKm, 45)
  assert.throws(
    () =>
      validateForecast({
        ...rawForecast(),
        hourly_units: { pm2_5: 'AQI', pm10: 'µg/m³' },
      }),
    ApiError,
  )
})
test('ambiguous CPCB pollutant_avg never gets guessed concentration units', () => {
  assert.equal(
    normalizeCpcb({
      pollutant_id: 'PM2.5',
      pollutant_avg: 50,
      latitude: 28.6,
      longitude: 77.2,
    }),
    null,
  )
})
test('reviewed CPCB timestamp meaning remains distinct from provider update time', () => {
  const metadata = {
      verified: true,
      quantity: 'concentration',
      unit: 'µg/m³',
      statistic: 'mean',
      periodSeconds: 86400,
      timestampField: 'last_update',
      timestampMeaning: 'provider_update',
      sourceDocument: 'https://www.data.gov.in/',
      reviewedAt: new Date().toISOString(),
      reviewedBy: 'test-only',
    },
    row = {
      station: 'SYNTHETIC',
      city: 'Delhi',
      pollutant_id: 'PM2.5',
      pollutant_avg: 0,
      latitude: 28.6,
      longitude: 77.2,
      last_update: '08-10-2026 10:00:00',
    }
  const result = normalizeCpcb(row, metadata)
  assert.equal(result.value, 0)
  assert.equal(result.observedAt, null)
  assert.ok(result.providerUpdatedAt)
  assert.equal(result.period, null)
  assert.equal(result.stale, true)
})
test('OpenAQ preserves owner, sensor identity, original time and unknown latest period', () => {
  const input = latest(),
    result = normalizeOpenAq(location, sensor, input)
  assert.equal(result.observedAt, input.datetime.utc)
  assert.equal(result.statistic, 'unknown')
  assert.equal(result.period, null)
  assert.equal(result.sensorId, '11')
  assert.equal(result.owner, 'Test fixture')
  assert.equal(
    normalizeOpenAq(
      location,
      { ...sensor, parameter: { name: 'pm25', units: 'AQI' } },
      input,
    ),
    null,
  )
})
test('history averages retain their exact period', () => {
  const result = normalizeOpenAq(location, sensor, hourly())
  assert.equal(result.statistic, 'mean')
  assert.ok(result.period.start)
  assert.ok(result.period.end)
})
test('comparison requires station identity, matching periods/statistics and detects shared origin', () => {
  const a = normalizeOpenAq(location, sensor, hourly())
  assert.equal(
    comparable(a, { ...a, canonicalStationId: null }).eligible,
    false,
  )
  assert.equal(comparable(a, { ...a, period: null }).eligible, false)
  assert.equal(
    comparable({ ...a, statistic: 'unknown' }, { ...a, statistic: 'unknown' })
      .eligible,
    false,
  )
  assert.equal(comparable(a, a).sharedOrigin, true)
  assert.equal(comparable(a, a).eligible, true)
})
test('freshness rejects future clocks and becomes stale without changing observed time', () => {
  const now = Date.now(),
    at = new Date(now).toISOString()
  assert.equal(sourceAge(at, now), 'current')
  assert.equal(sourceAge(at, now + 3 * 3600000 + 1), 'stale')
  assert.equal(
    sourceAge(new Date(now + 600000).toISOString(), now),
    'unverified',
  )
})
test('claim and optimistic replacement reject repeated and concurrent work', async () => {
  const store = new MemoryStore()
  assert.deepEqual(
    await Promise.all([store.claim('job', 60), store.claim('job', 60)]),
    [true, false],
  )
  assert.equal(await store.replace('plan', 'current', { x: 1 }, 0), true)
  assert.equal(await store.replace('plan', 'current', { x: 2 }, 0), false)
  assert.equal(await store.replace('plan', 'current', { x: 2 }, 1), true)
})
test('local file storage survives restart and keeps versions/leases', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'airday-test-'))
  try {
    const one = await new FileStore(directory).initialize()
    await one.replace('plan', 'current', { synthetic: true }, 0)
    await one.claim('job', 60)
    const two = await new FileStore(directory).initialize()
    assert.equal((await two.get('plan')).version, 1)
    assert.equal(await two.claim('job', 60), false)
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'airday-test-')))
    await rm(directory, { recursive: true, force: true })
  }
})
test('quota counts all calls and refuses budget exhaustion', async () => {
  const store = new MemoryStore()
  for (let n = 0; n < 40; n++) await quota(store, 'openaq', 123456)
  await assert.rejects(quota(store, 'openaq', 123456), { status: 429 })
  assert.equal((await store.get('QUOTA#openaq#60000#2', 'counter')).count, 40)
})
test('429 Retry-After sets cooldown and prevents further upstream requests', async () => {
  const store = new MemoryStore()
  let calls = 0
  const request = makeTransport(store, async () => {
    calls++
    return new Response('{}', {
      status: 429,
      headers: { 'retry-after': new Date(Date.now() + 120000).toUTCString() },
    })
  })
  await assert.rejects(
    request('openaq', new URL('https://api.openaq.org/v3/locations')),
    { status: 429 },
  )
  await assert.rejects(
    request('openaq', new URL('https://api.openaq.org/v3/locations')),
    { status: 503 },
  )
  assert.equal(calls, 1)
  assert.ok((await store.get('CIRCUIT#openaq')).data.until > Date.now())
})
test('transport rejects arbitrary hosts and oversized provider responses', async () => {
  const request = makeTransport(
    new MemoryStore(),
    async () => new Response('x'.repeat(4000001)),
  )
  await assert.rejects(request('openaq', new URL('http://127.0.0.1/')))
  await assert.rejects(
    request('openaq', new URL('https://api.openaq.org/v3/locations')),
    { status: 502 },
  )
})
test('OpenAQ metadata/latest/flags are shared between nearby area jobs', async () => {
  const store = new MemoryStore(),
    calls = []
  const request = async (_provider, url) => {
    calls.push(url.pathname)
    if (url.pathname.endsWith('/latest')) return { results: [latest()] }
    if (url.pathname.endsWith('/flags')) return { results: [] }
    return { results: [location], meta: { found: 1 } }
  }
  const area = areaFor(place)
  assert.equal(
    (await fetchOpenAq(area, request, store, { OPENAQ_API_KEY: 'test-only' }))
      .monitors.length,
    1,
  )
  await fetchOpenAq({ ...area, id: '28.7,77.2' }, request, store, {
    OPENAQ_API_KEY: 'test-only',
  })
  assert.equal(calls.filter((path) => path.endsWith('/latest')).length, 1)
})
test('OpenAQ reconciliation overlaps history, is idempotent, and preserves corrected revisions', async () => {
  const store = new MemoryStore(),
    area = areaFor(place),
    reading = hourly()
  await store.put(`REGISTRY#${area.id}`, 'current', { locations: [location] })
  await store.put('STATIONS', '1', {}, { expireAt: Date.now() / 1000 + 1000 })
  const request = async () => ({ results: [reading] })
  const first = await reconcileOpenAq(area, request, store, {
    OPENAQ_API_KEY: 'test-only',
  })
  assert.equal(first.records.length, 1)
  assert.equal(
    (
      await reconcileOpenAq(area, request, store, {
        OPENAQ_API_KEY: 'test-only',
      })
    ).records.length,
    0,
  )
  await store.delete(`HISTORY#${area.id}`, 'lock')
  await store.delete('RECONCILE#1', 'lock')
  await store.delete('RECONCILE_CURSOR#11')
  await reconcileOpenAq(area, request, store, { OPENAQ_API_KEY: 'test-only' })
  assert.equal((await store.list('HISTORY#11')).length, 1)
  await store.delete(`HISTORY#${area.id}`, 'lock')
  await store.delete('RECONCILE#1', 'lock')
  await store.delete('RECONCILE_CURSOR#11')
  await reconcileOpenAq(
    area,
    async () => ({ results: [{ ...reading, value: 43 }] }),
    store,
    { OPENAQ_API_KEY: 'test-only' },
  )
  assert.equal((await store.list('HISTORY#11')).length, 2)
})
test('spatial index finds adjacent tiles and preserves distance and timestamps', async () => {
  const store = new MemoryStore(),
    monitor = normalizeOpenAq(location, sensor, latest())
  await indexStations(store, [monitor])
  const rows = await nearbyStations(store, {
    latitude: 28.49,
    longitude: 77.21,
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].observedAt, monitor.observedAt)
  assert.ok(rows[0].distanceKm > 0)
})

test('bounded history pagination resumes at the next page rather than restarting', async () => {
  const store = new MemoryStore(),
    area = areaFor(place),
    calls = []
  await store.put(`REGISTRY#${area.id}`, 'current', { locations: [location] })
  await store.put('STATIONS', '1', {}, { expireAt: Date.now() / 1000 + 1000 })
  const request = async (_provider, url) => {
    const page = Number(url.searchParams.get('page'))
    calls.push(page)
    const count = page === 3 ? 1 : 100
    return {
      meta: { found: 201 },
      results: Array.from({ length: count }, (_, i) => ({
        ...hourly(),
        value: (page - 1) * 100 + i,
      })),
    }
  }
  const first = await reconcileOpenAq(area, request, store, {
    OPENAQ_API_KEY: 'test-only',
  })
  assert.equal(first.partial, true)
  assert.equal(first.records.length, 200)
  assert.equal((await store.get('RECONCILE_CURSOR#11')).data.page, 3)
  const second = await reconcileOpenAq(area, request, store, {
    OPENAQ_API_KEY: 'test-only',
  })
  assert.equal(second.partial, false)
  assert.equal(second.records.length, 1)
  assert.deepEqual(calls, [1, 2, 3])
  assert.equal((await store.list('HISTORY#11', 300)).length, 201)
})

test('DynamoDB audit writes are atomic and decision lists use the timeline index', async () => {
  const store = new DynamoStore('synthetic-table'),
    commands = []
  store.client = {
    send: async (command) => {
      commands.push(command)
      return { Items: [] }
    },
  }
  const data = { at: new Date().toISOString(), approval: 'pending' }
  await store.replaceWithAudit(
    'DECISIONS#tenant',
    'id',
    data,
    0,
    'AUDIT#tenant',
    { at: data.at, action: 'test' },
  )
  assert.equal(commands[0].constructor.name, 'TransactWriteCommand')
  assert.equal(commands[0].input.TransactItems.length, 2)
  assert.equal(
    commands[0].input.TransactItems[0].Put.ConditionExpression,
    'attribute_not_exists(pk)',
  )
  assert.equal(
    commands[0].input.TransactItems[0].Put.Item.timelinePk,
    'DECISIONS#tenant',
  )
  await store.list('DECISIONS#tenant')
  assert.equal(commands[1].input.IndexName, 'Timeline')
  assert.equal(commands[1].input.ConsistentRead, false)
  store.client.send = async () => {
    throw Object.assign(new Error('synthetic conflict'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    })
  }
  assert.equal(
    await store.replaceWithAudit(
      'DECISIONS#tenant',
      'id',
      data,
      0,
      'AUDIT#tenant',
      { at: data.at },
    ),
    false,
  )
})
test('device demand stores only coarse coordinates, not exact GPS', () => {
  const area = areaFor({ ...place, detected: true })
  assert.equal(area.city, '')
  assert.equal(area.state, '')
  assert.equal(area.latitude, 28.6)
  assert.notEqual(area.longitude, place.longitude)
})
const engineFor = (store, options = {}) =>
  createEngine({
    store,
    request: async () => rawForecast(),
    keys: async () => ({}),
    enqueue: async () => {},
    archive: async () => {},
    ...options,
  })
test('viewer bursts queue one job and make zero provider calls on reads', async () => {
  const store = new MemoryStore()
  let queued = 0,
    upstream = 0
  const engine = engineFor(store, {
    enqueue: async () => queued++,
    request: async () => {
      upstream++
      return rawForecast()
    },
  })
  await Promise.all(
    Array.from({ length: 20 }, () => engine.dashboard(place, '2030-10-08')),
  )
  assert.equal(queued, 1)
  assert.equal(upstream, 0)
})
test('forecast and observation failures are independent and old forecasts keep their original timestamp', async () => {
  const store = new MemoryStore(),
    area = areaFor(place),
    forecast = validateForecast(rawForecast(), 1),
    monitor = normalizeOpenAq(location, sensor, latest())
  await store.put(
    `SOURCE#${area.id}`,
    'forecast',
    { value: { forecast }, status: { status: 'live' } },
    { refreshAt: 0 },
  )
  await store.put(
    `SOURCE#${area.id}`,
    'openaq',
    { value: { monitors: [monitor] }, status: { status: 'live' } },
    { refreshAt: Date.now() + 60000 },
  )
  const engine = engineFor(store, {
    request: async () => {
      throw new ApiError('Synthetic outage', 502)
    },
  })
  await engine.refresh(area)
  const result = await engine.dashboard(place, '2030-10-08')
  assert.equal(result.forecast.fetchedAt, forecast.fetchedAt)
  assert.equal(result.sources.forecast.status, 'unavailable')
  assert.equal(result.monitors.length, 1)
  assert.ok(await store.get(`EVIDENCE#${result.snapshotId}`))
})
test('observation-only mode works when the forecast adapter fails', async () => {
  const store = new MemoryStore(),
    area = areaFor(place),
    monitor = normalizeOpenAq(location, sensor, latest())
  await store.put(
    `SOURCE#${area.id}`,
    'openaq',
    { value: { monitors: [monitor] }, status: { status: 'live' } },
    { refreshAt: Date.now() + 60000 },
  )
  const engine = engineFor(store, {
    request: async () => {
      throw new ApiError('Synthetic outage', 502)
    },
  })
  await engine.refresh(area)
  const result = await engine.dashboard(place, '2030-10-08')
  assert.equal(result.forecast, null)
  assert.equal(result.coverage.state, 'observations_only')
})
test('queue outage preserves cached evidence and reports scheduling failure', async () => {
  const store = new MemoryStore(),
    area = areaFor(place)
  await store.put(
    `SOURCE#${area.id}`,
    'forecast',
    {
      value: { forecast: validateForecast(rawForecast()) },
      status: { status: 'live' },
    },
    { refreshAt: 0 },
  )
  const result = await engineFor(store, {
    enqueue: async () => {
      throw new Error('synthetic queue outage')
    },
  }).dashboard(place, '2030-10-08')
  assert.ok(result.forecast)
  assert.match(result.ingestionWarning, /unavailable/)
})
test('expired TTL demand cannot bypass the active area limit', async () => {
  const store = new MemoryStore(),
    engine = engineFor(store)
  for (let i = 0; i < 20; i++)
    await store.put(
      'DEMAND',
      `fixture-${i}`,
      {},
      { expireAt: Date.now() / 1000 + 1000 },
    )
  await store.put('DEMAND', areaFor(place).id, areaFor(place), { expireAt: 1 })
  const result = await engine.dashboard(place, '2030-10-08')
  assert.equal(result.pending, false)
  assert.equal((await store.get('DEMAND', areaFor(place).id)).expireAt, 1)
})
test('paused ingestion keeps available forecasts readable', async () => {
  const store = new MemoryStore(),
    area = areaFor(place)
  await store.put('CONTROL', 'current', { paused: true })
  await store.put(`SOURCE#${area.id}`, 'forecast', {
    value: { forecast: validateForecast(rawForecast()) },
    status: { status: 'live' },
  })
  const result = await engineFor(store).dashboard(place, '2030-10-08')
  assert.equal(result.ingestionPaused, true)
  assert.ok(result.forecast)
})
test('unknown, revoked, stale and irrelevant policies cannot appear current', async () => {
  const base = {
    id: 'synthetic-policy',
    title: 'TEST ONLY',
    kind: 'order',
    status: 'reviewed',
    reviewedBy: 'test',
    reviewedAt: new Date().toISOString(),
    documentHash: 'a'.repeat(64),
    url: 'https://example.test/policy',
    jurisdictions: ['Delhi'],
    effectiveFrom: '2026-10-08',
  }
  const registry = (record) => ({ records: [record], sources: [] })
  assert.equal(
    (await policyFor(place, '2026-10-08', registry(base))).status,
    'reviewed_guidance',
  )
  for (const record of [
    { ...base, revokedAt: new Date().toISOString() },
    { ...base, reviewedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    { ...base, jurisdictions: ['Mumbai'] },
    { ...base, kind: 'schedule' },
  ])
    assert.equal(
      (await policyFor(place, '2026-10-08', registry(record))).status,
      'verification_needed',
    )
  assert.equal(
    (await policyFor(place, '2026-10-08', { records: [], sources: [] })).status,
    'verification_needed',
  )
})
test('hash identities are stable for the same evidence', () =>
  assert.equal(hash({ fixture: 1 }), hash({ fixture: 1 })))
