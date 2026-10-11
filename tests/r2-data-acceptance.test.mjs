import assert from 'node:assert/strict'
import test from 'node:test'
import { areaFor, validateForecast } from '../api/core.mjs'
import { historyRoute, retainRun } from '../api/history.mjs'
import { reconcileOpenAq, normalizeOpenAq } from '../api/providers.mjs'
import { MemoryStore, DynamoStore } from '../api/store.mjs'
import {
  modelIntervals,
  integrate,
  periodWindow,
  activityEstimate,
} from '../src/lib/periods.ts'
import { build } from 'esbuild'
import { mkdtemp, mkdir, unlink, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  validHistory,
  validHistoryRange,
  historySensors,
} from '../src/lib/history.ts'
import { location, sensor, hourly } from './fixtures.mjs'

// Explicit synthetic records. These checks do not call providers or establish live coverage.
const date = new Date().toLocaleDateString('sv-SE', {
  timeZone: 'Asia/Kolkata',
})
const place = {
  name: 'Synthetic Delhi',
  state: 'Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
}
const area = areaFor(place)
const at = (hour) => `${date}T${String(hour).padStart(2, '0')}:00:00+05:30`
const forecast = () =>
  validateForecast({
    timezone: 'Asia/Kolkata',
    utc_offset_seconds: 19800,
    latitude: 28.6,
    longitude: 77.2,
    hourly_units: { pm2_5: 'µg/m³', pm10: 'µg/m³', ozone: 'µg/m³' },
    hourly: {
      time: [at(0), at(1), at(2)],
      pm2_5: [0, 20, null],
      pm10: [10, 30, 50],
      ozone: [5, 10, 15],
    },
  })
const dashboard = () => ({
  schemaVersion: 2,
  snapshotId: 'a'.repeat(32),
  location: place,
  forecast: forecast(),
  monitors: [],
  sources: {
    forecast: { status: 'live' },
    openaq: { status: 'live' },
    cpcb: { status: 'no_data' },
  },
})
const parameters = (kind = 'runs', extras = {}) =>
  new URLSearchParams({ kind, from: date, to: date, ...extras })
const basePage = (kind) => ({
  schemaVersion: 1,
  areaId: area.id,
  kind,
  from: date,
  to: date,
  retrievedAt: new Date().toISOString(),
  retentionDays: 90,
  sourceMeaning: 'Retained synthetic evidence',
  nextCursor: null,
})
const observed = () =>
  normalizeOpenAq(location, sensor, {
    value: 0,
    period: {
      datetimeFrom: { utc: new Date(at(16)).toISOString() },
      datetimeTo: { utc: new Date(at(17)).toISOString() },
    },
  })
const observationPage = () => ({
  ...basePage('observations'),
  station: {
    station: location.name,
    sensorId: '11',
    source: 'OpenAQ',
    unit: 'µg/m³',
    url: 'https://explore.openaq.org/locations/1',
  },
  observations: [
    {
      ...observed(),
      firstFetchedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    },
  ],
})
const tempBase = join(process.cwd(), '.airday-test-temp')
await mkdir(tempBase, { recursive: true })
const directory = await mkdtemp(join(tempBase, 'r2-data-render-'))
const rendererPath = join(directory, 'render.mjs')
await build({
  stdin: {
    contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; import PollutantExplorer from './src/components/PollutantExplorer.tsx'; import HistoryTrends from './src/components/HistoryTrends.tsx'; export const explorer = props => renderToStaticMarkup(React.createElement(PollutantExplorer, props)); export const trends = props => renderToStaticMarkup(React.createElement(HistoryTrends, props));`,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  outfile: rendererPath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom/*'],
  define: { 'import.meta.env': '{}' },
  logLevel: 'silent',
})
const { explorer, trends } = await import(pathToFileURL(rendererPath).href)
test.after(async () => {
  await unlink(rendererPath)
  await rmdir(directory)
})

test('F11/F12 interval approximation preserves legacy particulate zero and missing gas data', () => {
  const data = dashboard()
  delete data.forecast.pollutants
  assert.equal(modelIntervals(data, 'pm25')[0].value, 0)
  assert.deepEqual(modelIntervals(data, 'no2'), [])
  assert.equal(
    modelIntervals(data, 'pm25')[0].end,
    new Date(Date.parse(at(0)) + 3600000).toISOString(),
  )
})
test('F11/F12 verified pollutant series preserves its own values', () => {
  assert.deepEqual(
    modelIntervals(dashboard(), 'o3').map((i) => i.value),
    [5, 10, 15],
  )
})
for (const [name, mutate] of [
  ['wrong unit', (s) => (s.unit = 'AQI')],
  ['different source', (s) => (s.source = 'Other model')],
  ['wrong statistic', (s) => (s.statistic = 'mean')],
  ['non-hourly step', (s) => (s.stepMinutes = 180)],
  ['mismatched particulate values', (s) => (s.values[0].value = 999)],
  ['different timestamps', (s) => (s.values[0].time = at(3))],
])
  test(`F11/F12 rejects ${name} instead of creating an apparently comparable mean`, () => {
    const data = dashboard()
    mutate(data.forecast.pollutants.pm25)
    assert.deepEqual(modelIntervals(data, 'pm25'), [])
  })
test('F12 fractional overlap uses requested duration and accepts complete zero', () => {
  const intervals = modelIntervals(dashboard(), 'pm25')
  const result = integrate(
    intervals,
    `${date}T00:30:00+05:30`,
    `${date}T01:30:00+05:30`,
  )
  assert.equal(result.mean, 10)
  assert.equal(result.total, 10)
  assert.equal(result.covered, 1)
  assert.equal(integrate(intervals, at(0), at(1)).mean, 0)
})
test('F12 gaps, nulls, overlaps and invalid windows withhold a period mean', () => {
  const intervals = modelIntervals(dashboard(), 'pm25')
  assert.equal(integrate(intervals, at(0), at(3)).mean, null)
  assert.equal(integrate([...intervals, intervals[0]], at(0), at(2)).mean, null)
  assert.equal(integrate(intervals, at(1), at(0)).mean, null)
  assert.equal(integrate(intervals, 'not-a-date', at(2)).mean, null)
})
test('F12 malformed timestamps and empty date/time fields never throw or normalize invalid calendar dates', () => {
  const data = dashboard()
  data.forecast.points[0].time = 'broken'
  delete data.forecast.pollutants
  assert.doesNotThrow(() => modelIntervals(data, 'pm25'))
  assert.equal(periodWindow('', '06:00', 8), null)
  assert.equal(periodWindow('2026-02-30', '06:00', 8), null)
  assert.equal(periodWindow(date, '', 8), null)
  assert.equal(periodWindow(date, '25:00', 8), null)
  assert.equal(periodWindow(date, '06:00', 0), null)
  assert.ok(periodWindow(date, '23:30', 24).end)
  assert.equal(
    activityEstimate(dashboard(), '2026-02-30', '00:00', '01:00').mean,
    null,
  )
  assert.equal(activityEstimate(dashboard(), date, '00:00', '24:00').mean, null)
})
test('F07 validates real calendar ranges and the inclusive 31-day bound', () => {
  assert.equal(validHistoryRange('2026-10-01', '2026-10-31'), true)
  assert.equal(validHistoryRange('2026-10-01', '2026-11-01'), false)
  assert.equal(validHistoryRange('2026-02-30', '2026-03-01'), false)
  assert.equal(validHistoryRange('', date), false)
})
test('F07 client sensor catalog merges separate cards and deduplicates numeric sensors', () => {
  const data = dashboard()
  const m = observed()
  data.monitors = [m, { ...m, sensorId: '12' }]
  data.nearbyMonitors = [
    m,
    { ...m, sensorId: 'bad' },
    { ...m, sensorId: '13', unit: 'AQI' },
  ]
  assert.deepEqual(
    historySensors(data).map((m) => m.sensorId),
    ['11', '12'],
  )
  data.monitors.push({ ...m, sensorId: '14', latitude: 18, longitude: 73 })
  assert.deepEqual(
    historySensors(data).map((m) => m.sensorId),
    ['11', '12'],
  )
})
test('F07 observation contract accepts complete zero with explicit matching mean interval', () => {
  assert.equal(
    validHistory(observationPage(), dashboard(), 'observations', date, date),
    true,
  )
})
for (const [name, mutate] of [
  ['missing interval', (p) => (p.observations[0].period = null)],
  [
    'interval timestamp disagreement',
    (p) => (p.observations[0].observedAt = at(18)),
  ],
  ['different unit', (p) => (p.station.unit = 'AQI')],
  [
    'different station URL',
    (p) => (p.observations[0].url = 'https://explore.openaq.org/locations/2'),
  ],
  [
    'out-of-range record',
    (p) => {
      p.observations[0].observedAt = '2025-01-01T01:00:00Z'
      p.observations[0].period = {
        start: '2025-01-01T00:00:00Z',
        end: '2025-01-01T01:00:00Z',
      }
    },
  ],
  ['duplicate revision ID', (p) => p.observations.push(p.observations[0])],
  [
    'wrong first-retrieval timestamp',
    (p) => (p.observations[0].firstFetchedAt = 'invalid'),
  ],
  ['null record', (p) => (p.observations = [null])],
])
  test(`F07 rejects ${name} history payload`, () => {
    const page = observationPage()
    mutate(page)
    assert.equal(
      validHistory(page, dashboard(), 'observations', date, date),
      false,
    )
  })
test('F07 retained forecast contracts bind grid metadata to the selected run', async () => {
  const store = new MemoryStore(),
    f = forecast()
  await retainRun(store, area, f)
  const page = await historyRoute(
    parameters('forecast', { run: f.id }),
    place,
    store,
  )
  assert.equal(validHistory(page, dashboard(), 'forecast', date, date), true)
  page.run.grid.latitude = 29
  assert.equal(validHistory(page, dashboard(), 'forecast', date, date), false)
  page.forecast.grid = null
  assert.doesNotThrow(() =>
    validHistory(page, dashboard(), 'forecast', date, date),
  )
})
test('F07 run catalog rejects retrieved dates outside the requested range', async () => {
  const store = new MemoryStore(),
    f = forecast()
  await retainRun(store, area, f)
  const page = await historyRoute(parameters(), place, store)
  assert.equal(validHistory(page, dashboard(), 'runs', date, date), true)
  page.runs[0].retrievedAt = '2025-01-01T00:00:00Z'
  assert.equal(validHistory(page, dashboard(), 'runs', date, date), false)
})
test('F07 history cursor is range/source scoped and cannot skip beyond a requested range', async () => {
  const store = new MemoryStore(),
    params = parameters()
  await retainRun(store, area, forecast())
  for (let i = 0; i < 51; i++)
    await store.put(
      `RUNS#${area.id}`,
      `${new Date(Date.parse(at(1)) + i * 1000).toISOString()}#${String(i).padStart(32, 'a')}`,
      { id: String(i).padStart(32, 'a') },
    )
  const first = await historyRoute(params, place, store)
  assert.equal(first.runs.length, 50)
  assert.ok(first.nextCursor)
  params.set('cursor', first.nextCursor)
  const second = await historyRoute(params, place, store)
  assert.equal(first.runs.length + second.runs.length, 52)
  assert.equal(
    new Set([...first.runs, ...second.runs].map((r) => r.id)).size,
    52,
  )
  assert.equal(second.nextCursor, null)
  const changedRange = new URLSearchParams(params)
  changedRange.set(
    'from',
    new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10),
  )
  await assert.rejects(historyRoute(changedRange, place, store), /cursor/)
  const parsed = JSON.parse(
    Buffer.from(first.nextCursor, 'base64url').toString(),
  )
  parsed.after = '2099-10-01T00:00:00.000Z#' + 'a'.repeat(32)
  params.set(
    'cursor',
    Buffer.from(JSON.stringify(parsed)).toString('base64url'),
  )
  await assert.rejects(historyRoute(params, place, store), /cursor/)
})
test('F07 501 production-keyed observations continue without loss or duplicate rows', async () => {
  const store = new MemoryStore(),
    monitor = observed(),
    from = new Date(Date.parse(date) - 30 * 86400000)
      .toISOString()
      .slice(0, 10),
    params = parameters('observations', { from, sensor: monitor.sensorId }),
    latest = Date.parse(at(18))
  await store.put(`SOURCE#${area.id}`, 'openaq', {
    value: { monitors: [monitor] },
  })
  for (let i = 0; i < 501; i++) {
    const end = new Date(latest - i * 3600000).toISOString(),
      start = new Date(latest - (i + 1) * 3600000).toISOString(),
      record = normalizeOpenAq(location, sensor, {
        value: i % 17 === 0 ? 0 : 40 + (i % 20),
        period: {
          datetimeFrom: { utc: start },
          datetimeTo: { utc: end },
        },
      })
    assert.ok(record?.period)
    // Match reconcileOpenAq's production key, including the revision hash.
    await store.put(
      `HISTORY#${monitor.sensorId}`,
      `${record.observedAt}#${record.id}`,
      record,
      { expireAt: Math.floor(Date.now() / 1000) + 86400 },
    )
  }
  const first = await historyRoute(params, place, store)
  assert.equal(first.observations.length, 500)
  assert.ok(first.nextCursor)
  assert.equal(
    validHistory(first, dashboard(), 'observations', from, date),
    true,
  )
  const decoded = JSON.parse(
    Buffer.from(first.nextCursor, 'base64url').toString(),
  )
  assert.match(
    decoded.after,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#[a-f0-9]{32}$/,
  )
  params.set('cursor', first.nextCursor)
  const second = await historyRoute(params, place, store)
  assert.equal(second.observations.length, 1)
  assert.equal(second.nextCursor, null)
  assert.equal(
    validHistory(second, dashboard(), 'observations', from, date),
    true,
  )
  const records = [...first.observations, ...second.observations]
  assert.equal(new Set(records.map((r) => r.id)).size, 501)
  assert.equal(records.at(-1).observedAt, new Date(latest).toISOString())
  assert.ok(records.some((r) => r.value === 0))

  decoded.after = decoded.after.split('#')[0]
  params.set(
    'cursor',
    Buffer.from(JSON.stringify(decoded)).toString('base64url'),
  )
  await assert.rejects(historyRoute(params, place, store), (error) => {
    assert.equal(error.status, 400)
    assert.match(error.message, /cursor/)
    return true
  })
})
test('F07 expired records stay absent in local range and cloud range before physical TTL deletion', async () => {
  const row = {
    pk: 'HISTORY#11',
    sk: new Date(at(1)).toISOString() + '#a',
    data: observed(),
    expireAt: Date.now() / 1000 - 1,
  }
  const memory = new MemoryStore()
  await memory.put(row.pk, row.sk, row.data, { expireAt: row.expireAt })
  assert.equal((await memory.range(row.pk, '0', 'z', 500)).rows.length, 0)
  const cloud = new DynamoStore('synthetic-table')
  cloud.client = {
    send: async () => ({
      Items: [row],
      LastEvaluatedKey: { pk: row.pk, sk: row.sk },
    }),
  }
  const page = await cloud.range(row.pk, '0', 'z', 500)
  assert.equal(page.rows.length, 0)
  assert.equal(page.after, row.sk)
})
test('F07 run retrieval freezes first retrieval rather than rewriting it on a repeat fetch', async () => {
  const store = new MemoryStore(),
    f = forecast()
  await retainRun(store, area, f)
  const original = (await store.get(`FORECAST#${f.id}`)).data
  await retainRun(store, area, {
    ...f,
    fetchedAt: new Date(Date.now() + 1000).toISOString(),
  })
  assert.equal(
    (await store.get(`FORECAST#${f.id}`)).data.fetchedAt,
    original.fetchedAt,
  )
  assert.equal(
    (await store.get(`RUN#${area.id}`, f.id)).data.retrievedAt,
    original.fetchedAt,
  )
  assert.equal(
    (await store.get(`RUN#${area.id}`, f.id)).expireAt,
    (await store.get(`FORECAST#${f.id}`)).expireAt,
  )
})
test('F07 retaining a previously expired hash restores the body before publishing its catalog', async () => {
  const store = new MemoryStore(),
    f = forecast()
  await retainRun(store, area, f)
  for (const row of store.rows.values()) row.expireAt = Date.now() / 1000 - 1
  const replacement = {
    ...f,
    fetchedAt: new Date(Date.now() + 1000).toISOString(),
  }
  await retainRun(store, area, replacement)
  const retained = await historyRoute(
    parameters('forecast', { run: f.id }),
    place,
    store,
  )
  assert.equal(retained.forecast.fetchedAt, replacement.fetchedAt)
  assert.equal(retained.run.retrievedAt, replacement.fetchedAt)
})
test('F07 failed reconciliation releases its area lease so retry can run', async () => {
  const store = new MemoryStore()
  await store.put(`REGISTRY#${area.id}`, 'current', { locations: [location] })
  await store.put('STATIONS', '1', {}, { expireAt: Date.now() / 1000 + 1000 })
  await assert.rejects(
    reconcileOpenAq(
      area,
      async () => {
        throw new Error('Synthetic network loss')
      },
      store,
      { OPENAQ_API_KEY: 'test-only' },
    ),
    /Synthetic/,
  )
  const retry = await reconcileOpenAq(
    area,
    async () => ({ results: [hourly()] }),
    store,
    { OPENAQ_API_KEY: 'test-only' },
  )
  assert.equal(retry.skipped, false)
  assert.equal(retry.records.length, 1)
})
test('F07 ingestion budget never exceeds 500 records and continues the unprocessed page', async () => {
  const store = new MemoryStore()
  const locations = [1, 2, 3].map((id) => ({
    ...location,
    id,
    sensors: [{ ...sensor, id: id * 10 + 1 }],
  }))
  await store.put(`REGISTRY#${area.id}`, 'current', { locations })
  for (const loc of locations)
    await store.put(
      'STATIONS',
      String(loc.id),
      {},
      { expireAt: Date.now() / 1000 + 1000 },
    )
  const calls = []
  const request = async (_provider, url) => {
    const id = Number(url.pathname.split('/')[3]),
      page = Number(url.searchParams.get('page'))
    calls.push([id, page])
    return {
      meta: { found: 201 },
      results: Array.from({ length: 100 }, (_, i) => ({
        ...hourly(),
        value: id === 11 && page === 1 && i < 50 ? null : i,
      })),
    }
  }
  const first = await reconcileOpenAq(area, request, store, {
    OPENAQ_API_KEY: 'test-only',
  })
  assert.ok(first.records.length <= 500)
  assert.equal(first.partial, true)
  assert.deepEqual(calls, [
    [11, 1],
    [11, 2],
    [21, 1],
    [21, 2],
    [31, 1],
  ])
  const second = await reconcileOpenAq(area, request, store, {
    OPENAQ_API_KEY: 'test-only',
  })
  assert.equal(second.skipped, false)
  assert.ok(calls.some(([id, page]) => id === 31 && page === 2))
})
test('F11/F12 rendered comparison explains model-only approximation, missing coverage and accessible values', () => {
  const markup = explorer({
    data: dashboard(),
    date,
    language: 'en',
    now: Date.now(),
  })
  assert.match(markup, /Overlap-weighted model estimate/)
  assert.match(markup, /Incomplete: mean withheld/)
  assert.match(markup, /All model samples \(accessible table\)/)
  assert.match(markup, /not official AQI/)
  assert.match(markup, /Baseline dots are valid zero values/)
})
test('F12 rendered blank/invalid dates remain recoverable with a missing mean', () => {
  for (const invalidDate of ['', '2026-02-30']) {
    const markup = explorer({
      data: dashboard(),
      date: invalidDate,
      language: 'en',
      now: Date.now(),
    })
    assert.match(markup, /Choose a valid date/)
    assert.match(markup, /Incomplete: mean withheld/)
  }
})
test('F07/F17 rendered history distinguishes public retained evidence from private journal and labels bounded pages in Hindi', () => {
  const markup = trends({
    data: dashboard(),
    language: 'hi',
    active: true,
    now: Date.now(),
  })
  assert.match(markup, /प्रति पृष्ठ 50 मॉडल या 500 मापन/)
  assert.match(markup, /स्थानीय निर्णय रिपोर्ट इस सर्वर डेटा इतिहास से अलग/)
  assert.match(markup, /खाली दिन या अलग स्रोत नहीं मिलाए जाते/)
})
