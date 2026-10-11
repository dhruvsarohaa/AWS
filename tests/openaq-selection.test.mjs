import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchOpenAq,
  normalizeOpenAq,
  selectOpenAqLocations,
  OPENAQ_SELECTION_VERSION,
} from '../api/providers.mjs'
import { MemoryStore } from '../api/store.mjs'
import { admitStation, stationCapacity } from '../api/spatial.mjs'
import { quota } from '../api/transport.mjs'
import { createEngine } from '../api/engine.mjs'
import { areaFor } from '../api/core.mjs'

// Synthetic contract checks, not evidence of live station coverage.
const now = Date.parse('2026-10-10T18:00:00Z')
const area = { id: '28.6,77.2', latitude: 28.6, longitude: 77.2 }
const station = (id, latitude = 28.6, extra = {}) => ({
  id,
  name: `SYNTHETIC station ${id}`,
  country: { code: 'IN' },
  isMobile: false,
  isMonitor: true,
  coordinates: { latitude, longitude: 77.2 },
  datetimeLast: { utc: '2026-10-10T17:00:00Z' },
  sensors: [{ id: id * 10, parameter: { name: 'pm25', units: 'µg/m³' } }],
  ...extra,
})

async function dashboardFor(monitors) {
  const store = new MemoryStore()
  const place = {
    name: 'SYNTHETIC Delhi',
    state: 'Delhi',
    latitude: area.latitude,
    longitude: area.longitude,
  }
  const selectedArea = areaFor(place)
  for (const provider of ['forecast', 'openaq', 'cpcb'])
    await store.put(
      `SOURCE#${selectedArea.id}`,
      provider,
      {
        status: { status: 'live' },
        value: provider === 'openaq' ? { monitors } : {},
      },
      { refreshAt: Date.now() + 60_000 },
    )
  return createEngine({
    store,
    keys: {},
    request: async () => {
      throw new Error('SYNTHETIC dashboard test must not call a provider')
    },
    enqueue: async () => {
      throw new Error('SYNTHETIC dashboard test must not enqueue a refresh')
    },
  }).dashboard(place, '2026-10-11')
}

test('same-site PM2.5 sensors prefer the newer actual observation without relabelling stale data', async () => {
  const location = station(1)
  const staleTimes = ['2022-10-16T16:00:00Z', '2026-10-07T14:30:00Z']
  const monitors = staleTimes.map((utc, index) =>
    normalizeOpenAq(
      location,
      { ...location.sensors[0], id: 100 + index },
      { value: index ? 41 : 20, datetime: { utc } },
    ),
  )
  const result = await dashboardFor(monitors)
  assert.equal(result.monitors[0].sensorId, '101')
  assert.equal(result.monitors[0].observedAt, '2026-10-07T14:30:00.000Z')
  assert.equal(result.monitors[0].value, 41)
  assert.equal(result.monitors[0].stale, true)
  assert.equal(result.monitors[0].period, null)
  assert.equal(result.monitors[0].statistic, 'unknown')
  assert.deepEqual(
    result.nearbyMonitors.map((row) => row.sensorId),
    ['101', '100'],
  )
})

test('actual observation tie-break preserves distance, freshness and quality ordering', async () => {
  const old = normalizeOpenAq(station(1), station(1).sensors[0], {
    value: 20,
    datetime: { utc: '2022-10-16T16:00:00Z' },
  })
  const newer = normalizeOpenAq(station(2, 28.61), station(2).sensors[0], {
    value: 41,
    datetime: { utc: '2026-10-07T14:30:00Z' },
  })
  assert.equal((await dashboardFor([old, newer])).monitors[0].sensorId, '10')
  const fresh = {
    ...newer,
    observedAt: new Date(Date.now() - 60_000).toISOString(),
  }
  assert.equal((await dashboardFor([old, fresh])).monitors[0].sensorId, '20')
  const flaggedSameSite = {
    ...newer,
    latitude: old.latitude,
    qualityFlags: ['SYNTHETIC flag'],
  }
  assert.equal(
    (await dashboardFor([flaggedSameSite, old])).monitors[0].sensorId,
    '10',
  )
})

test('same-site observation tie-break treats missing timestamps as older than valid timestamps', async () => {
  const old = normalizeOpenAq(station(1), station(1).sensors[0], {
    value: 20,
    datetime: { utc: '2022-10-16T16:00:00Z' },
  })
  const missing = { ...old, sensorId: '20', observedAt: null }
  assert.equal((await dashboardFor([missing, old])).monitors[0].sensorId, '10')
})

test('recent eligible candidates beyond the nearest five replace obsolete stations', () => {
  const oldNearest = Array.from({ length: 5 }, (_, i) =>
    station(i + 1, 28.6 + i / 1000, {
      datetimeLast: { utc: '2016-11-09T16:30:00Z' },
    }),
  )
  const recent = station(16, 28.64)
  const selected = selectOpenAqLocations(area, [...oldNearest, recent], now)
  assert.equal(selected[0].id, 16)
  assert.equal(selected.length, 5)
})

test('recent provider reference-monitor metadata is preferred without replacing source timestamps', () => {
  const citizen = station(1, 28.601, { isMonitor: false })
  const reference = station(2, 28.65)
  assert.deepEqual(
    selectOpenAqLocations(area, [citizen, reference], now).map((row) => row.id),
    [2, 1],
  )
  const normalized = normalizeOpenAq(
    reference,
    reference.sensors[0],
    {
      value: 0,
      datetime: { utc: '2026-10-10T17:30:00Z' },
    },
    now,
  )
  assert.equal(normalized.referenceMonitor, true)
  assert.equal(normalized.siting, 'not_verified')
  assert.equal(normalized.value, 0)
  assert.equal(normalized.observedAt, '2026-10-10T17:30:00.000Z')
  assert.equal(normalized.period, null)
  assert.equal(normalized.statistic, 'unknown')
})

test('catalog timestamp is only a lookup hint and cannot make an old PM2.5 measurement current', () => {
  const recentCatalog = selectOpenAqLocations(area, [station(1)], now)[0]
  const result = normalizeOpenAq(
    recentCatalog,
    recentCatalog.sensors[0],
    {
      value: 48,
      datetime: { utc: '2026-10-07T14:30:00Z' },
    },
    now,
  )
  assert.equal(result.stale, true)
  assert.equal(result.observedAt, '2026-10-07T14:30:00.000Z')
})

test('future, impossible and absent catalog times are never prioritized as current', () => {
  const rows = [
    station(1, 28.6, { datetimeLast: { utc: '2026-10-10T20:00:00Z' } }),
    station(2, 28.6, { datetimeLast: { utc: '2026-02-30T17:00:00Z' } }),
    station(3, 28.6, { datetimeLast: null }),
    station(4, 28.67),
  ]
  assert.equal(selectOpenAqLocations(area, rows, now)[0].id, 4)
})

test('invalid units, mobile/non-Indian/out-of-radius/invalid coordinates and explicit indoor labels are excluded', () => {
  const rejected = [
    station(1, 28.6, { isMobile: true }),
    station(2, 28.6, { country: { code: 'US' } }),
    station(3, 29.2),
    station(4, 28.6, { coordinates: { latitude: null, longitude: 77.2 } }),
    station(5, 28.6, {
      sensors: [{ id: 50, parameter: { name: 'pm25', units: 'AQI' } }],
    }),
    station(6, 28.6, { name: 'SYNTHETIC Indoor Air' }),
    station(7, 28.6, { owner: { name: 'SYNTHETIC indoor installation' } }),
    station(8, 28.6, { sensors: null }),
  ]
  assert.deepEqual(selectOpenAqLocations(area, rejected, now), [])
})

test('candidate IDs are unique and lookup selection is deterministic and bounded to five', () => {
  const rows = Array.from({ length: 20 }, (_, i) => station(i + 1))
  const selected = selectOpenAqLocations(
    area,
    [...rows.reverse(), station(1)],
    now,
  )
  assert.deepEqual(
    selected.map((row) => row.id),
    [1, 2, 3, 4, 5],
  )
})

test('a legacy registry is rediscovered; new selection performs no more than five latest calls', async () => {
  const store = new MemoryStore()
  await store.put(`REGISTRY#${area.id}`, 'current', {
    locations: [station(99)],
    fetchedAt: Date.now(),
  })
  const calls = []
  const current = new Date().toISOString()
  const rows = Array.from({ length: 20 }, (_, i) =>
    station(i + 1, 28.6, { datetimeLast: { utc: current } }),
  )
  const request = async (_provider, url) => {
    calls.push(url.pathname)
    if (url.pathname === '/v3/locations')
      return { meta: { found: 20 }, results: rows }
    if (url.pathname.endsWith('/flags')) return { results: [] }
    const id = Number(url.pathname.split('/')[3])
    return {
      results: [{ sensorsId: id * 10, value: id, datetime: { utc: current } }],
    }
  }
  const result = await fetchOpenAq(area, request, store, {
    OPENAQ_API_KEY: 'SYNTHETIC_TEST_KEY',
  })
  assert.equal(calls.filter((path) => path === '/v3/locations').length, 1)
  assert.equal(calls.filter((path) => path.endsWith('/latest')).length, 5)
  assert.equal(result.monitors.length, 5)
  const registry = (await store.get(`REGISTRY#${area.id}`)).data
  assert.equal(registry.selectionVersion, OPENAQ_SELECTION_VERSION)
  assert.equal(registry.returnedCatalogCount, 20)
  assert.equal(registry.locations.length, 5)
  assert.equal(registry.truncated, false)
})

test('failed rediscovery does not mutate or erase legacy catalog or retained measurement timestamps', async () => {
  const store = new MemoryStore()
  const original = { locations: [station(1)], fetchedAt: Date.now() }
  await store.put(`REGISTRY#${area.id}`, 'current', original)
  const retained = normalizeOpenAq(
    station(1),
    station(1).sensors[0],
    {
      value: 42,
      datetime: { utc: '2026-10-07T14:30:00Z' },
    },
    now,
  )
  await store.put('LATEST#1', 'current', [retained])
  await assert.rejects(
    fetchOpenAq(
      area,
      async () => {
        throw new Error('SYNTHETIC outage')
      },
      store,
      { OPENAQ_API_KEY: 'SYNTHETIC_TEST_KEY' },
    ),
  )
  assert.deepEqual((await store.get(`REGISTRY#${area.id}`)).data, original)
  assert.deepEqual((await store.get('LATEST#1')).data, [retained])
})

test('unknown provider monitor classification remains unknown instead of being certified', () => {
  const location = station(1, 28.6, { isMonitor: undefined })
  assert.equal(
    normalizeOpenAq(
      location,
      location.sensors[0],
      {
        value: 42,
        datetime: { utc: '2026-10-10T17:30:00Z' },
      },
      now,
    ).referenceMonitor,
    null,
  )
})

test('station capacity defaults to 20 and rejects malformed or unbounded configuration', () => {
  const previous = process.env.AIRDAY_MAX_ACTIVE_STATIONS
  delete process.env.AIRDAY_MAX_ACTIVE_STATIONS
  try {
    assert.equal(stationCapacity(), 20)
    assert.equal(stationCapacity('20'), 20)
    assert.equal(stationCapacity('40'), 40)
    for (const value of [
      '0',
      '19',
      '41',
      '200',
      '20.5',
      'NaN',
      'Infinity',
      ' 40',
      '040',
      false,
    ])
      assert.throws(() => stationCapacity(value), /integer from 20 to 40/)
  } finally {
    if (previous === undefined) delete process.env.AIRDAY_MAX_ACTIVE_STATIONS
    else process.env.AIRDAY_MAX_ACTIVE_STATIONS = previous
  }
})

test('capacity exhaustion is explicit and cannot be mistaken for a city with no monitor network', async () => {
  const previous = process.env.AIRDAY_MAX_ACTIVE_STATIONS
  process.env.AIRDAY_MAX_ACTIVE_STATIONS = '20'
  const store = new MemoryStore()
  const expiry = Date.now() / 1000 + 3600
  for (let id = 21; id <= 40; id++)
    await store.put('STATIONS', String(id), {}, { expireAt: expiry })
  try {
    const result = await fetchOpenAq(
      area,
      async () => ({ results: [station(1)] }),
      store,
      { OPENAQ_API_KEY: 'SYNTHETIC_TEST_KEY' },
    )
    assert.equal(result.status.status, 'unavailable')
    assert.match(
      result.status.message,
      /bounded active-station capacity is full/,
    )
    assert.match(
      result.status.message,
      /does not mean the city has no monitors/,
    )
    assert.deepEqual(result.monitors, [])
  } finally {
    if (previous === undefined) delete process.env.AIRDAY_MAX_ACTIVE_STATIONS
    else process.env.AIRDAY_MAX_ACTIVE_STATIONS = previous
  }
})

test('a 40-station pilot admits bounded new stations without evicting existing 20 leases or evidence', async () => {
  const previous = process.env.AIRDAY_MAX_ACTIVE_STATIONS
  const store = new MemoryStore()
  const expiry = Date.now() / 1000 + 3600
  for (let id = 1; id <= 20; id++)
    await store.put('STATIONS', String(id), {}, { expireAt: expiry })
  await store.put('LATEST#1', 'current', { observedAt: '2026-10-07T14:30:00Z' })
  try {
    delete process.env.AIRDAY_MAX_ACTIVE_STATIONS
    assert.equal(await admitStation(store, '21'), false)
    process.env.AIRDAY_MAX_ACTIVE_STATIONS = '40'
    for (let id = 21; id <= 40; id++)
      assert.equal(await admitStation(store, String(id)), true)
    assert.equal(await admitStation(store, '41'), false)
    assert.equal((await store.list('STATIONS', 100)).length, 40)
    assert.deepEqual((await store.get('LATEST#1')).data, {
      observedAt: '2026-10-07T14:30:00Z',
    })
    process.env.AIRDAY_MAX_ACTIVE_STATIONS = 'unbounded'
    await assert.rejects(admitStation(store, '42'), /integer from 20 to 40/)
    assert.equal((await store.list('STATIONS', 100)).length, 40)
  } finally {
    if (previous === undefined) delete process.env.AIRDAY_MAX_ACTIVE_STATIONS
    else process.env.AIRDAY_MAX_ACTIVE_STATIONS = previous
  }
})

test('temporary admission lease contention is not labelled as exhausted station capacity', async () => {
  const store = new MemoryStore()
  await store.claim('STATION_ADMISSION', 10)
  const result = await fetchOpenAq(
    area,
    async () => ({ results: [station(1)] }),
    store,
    { OPENAQ_API_KEY: 'SYNTHETIC_TEST_KEY' },
  )
  assert.equal(result.status.status, 'unavailable')
  assert.doesNotMatch(result.status.message, /capacity is full/)
})

test('40-station refresh allowance including two-attempt requests fits hourly and daily OpenAQ budgets when paced', async () => {
  // Latest: 40 * 4/hr; flags: 40 * 1/hr; history: 40 * 2 sensors * 2 pages / 6 hr.
  // Metadata: 20 areas / 6 hr. All provider operations remain additionally
  // constrained by quota(), including minute bursts and backlogs.
  const dailyAllowance = 2 * (40 * 4 * 24 + 40 * 24 + 40 * 2 * 2 * 4 + 20 * 4)
  const hourlyAllowance = Math.ceil(dailyAllowance / 24)
  assert.equal(dailyAllowance, 11040)
  assert.equal(hourlyAllowance, 460)
  assert.ok(dailyAllowance < 20000)
  assert.ok(hourlyAllowance < 1400)
  const store = new MemoryStore()
  const start = Math.floor(now / 3600000) * 3600000
  for (let i = 0; i < hourlyAllowance; i++)
    await quota(
      store,
      'openaq',
      start + Math.floor((i * 3600000) / hourlyAllowance),
    )
  const burst = new MemoryStore()
  for (let i = 0; i < 40; i++) await quota(burst, 'openaq', now)
  await assert.rejects(quota(burst, 'openaq', now), /request budget/)
})
