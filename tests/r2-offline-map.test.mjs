import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import {
  plannerShellNavigation,
  precacheAsset,
  requiredShellAssets,
} from '../scripts/pwa-policy.mjs'
import {
  publicOfflineEvidence,
  offlineAreaKey,
  offlineDashboard,
} from '../src/lib/public-evidence.ts'
import { validDashboard } from '../src/lib/contracts.ts'

const fixture = () => ({
  schemaVersion: 2,
  snapshotId: 'a'.repeat(32),
  location: {
    name: 'SYNTHETIC Delhi',
    state: 'Delhi',
    country: 'India',
    latitude: 28.6139,
    longitude: 77.209,
    detected: true,
    accuracyMeters: 4,
    detectedAt: '2030-10-10T00:00:00Z',
    confirmed: true,
  },
  forecast: {
    id: 'b'.repeat(32),
    source: 'SYNTHETIC regional model',
    timezone: 'Asia/Kolkata',
    fetchedAt: '2030-10-10T00:00:00Z',
    grid: { latitude: 28.6, longitude: 77.2 },
    points: [{ time: '2030-10-10T08:00:00+05:30', pm25: 0, pm10: null }],
  },
  monitors: [
    {
      source: 'OpenAQ',
      station: 'SYNTHETIC station',
      latitude: 28.614,
      longitude: 77.21,
      distanceKm: 0.1,
      pollutant: 'PM2.5',
      value: 0,
      unit: 'µg/m³',
      observedAt: '2030-10-09T22:00:00Z',
      stale: false,
      url: 'https://openaq.org',
      sensorId: '123',
      statistic: 'unknown',
      period: null,
    },
  ],
  sources: {
    forecast: { status: 'live', lastAttemptAt: '2030-10-10T00:00:00Z' },
    openaq: { status: 'live' },
    cpcb: { status: 'not_configured' },
  },
  policy: {
    date: '2030-10-10',
    version: 'synthetic',
    status: 'unverified',
    message: 'SYNTHETIC only',
    records: [],
    sources: [],
  },
})

test('F21 offline presentation withholds current provider verification while preserving clocks', () => {
  const original = fixture()
  original.sources.cpcb.status = 'not_configured'
  const offline = offlineDashboard(original, true)
  assert.equal(offline.sources.openaq.status, 'unavailable')
  assert.equal(offline.sources.forecast.status, 'unavailable')
  assert.equal(offline.sources.cpcb.status, 'not_configured')
  assert.equal(offline.forecast.fetchedAt, original.forecast.fetchedAt)
  assert.equal(offline.monitors[0].observedAt, original.monitors[0].observedAt)
  assert.equal(original.sources.openaq.status, 'live')
  assert.equal(offline.pending, false)
})

test('F21 public cache rounds selected GPS, recomputes distance, preserves original clocks/zero and isolates returned state', () => {
  const input = fixture(),
    output = publicOfflineEvidence(input)
  assert.equal(validDashboard(output), true)
  assert.deepEqual(output.location, {
    name: 'SYNTHETIC Delhi',
    state: 'Delhi',
    country: 'India',
    latitude: 28.6,
    longitude: 77.2,
    confirmed: true,
  })
  assert.equal(output.forecast.fetchedAt, input.forecast.fetchedAt)
  assert.equal(output.monitors[0].observedAt, input.monitors[0].observedAt)
  assert.equal(output.monitors[0].value, 0)
  assert.ok(output.monitors[0].distanceKm > 1)
  input.forecast.points[0].pm25 = 200
  assert.equal(output.forecast.points[0].pm25, 0)
  assert.equal(offlineAreaKey(input.location), offlineAreaKey(output.location))
})
test('F21 public cache drops unexpected private fields at every retained envelope', () => {
  const input = fixture()
  input.authToken = 'PRIVATE_SENTINEL'
  input.plan = { reason: 'PRIVATE_SENTINEL' }
  input.location.preciseGps = 'PRIVATE_SENTINEL'
  input.forecast.privateWorkspace = 'PRIVATE_SENTINEL'
  input.forecast.grid.private = 'PRIVATE_SENTINEL'
  input.forecast.points[0].personal = 'PRIVATE_SENTINEL'
  input.monitors[0].personal = 'PRIVATE_SENTINEL'
  input.monitors[0].qualityFlags = [
    { token: 'PRIVATE_SENTINEL' },
    'public-quality-flag',
  ]
  input.sources.forecast.auth = 'PRIVATE_SENTINEL'
  input.policy.private = 'PRIVATE_SENTINEL'
  assert.ok(
    !JSON.stringify(publicOfflineEvidence(input)).includes('PRIVATE_SENTINEL'),
  )
})
test('F21 observations-only valid evidence can be read offline; malformed units stay rejected', () => {
  const input = fixture()
  input.forecast = null
  assert.equal(validDashboard(publicOfflineEvidence(input)), true)
  input.monitors[0].unit = 'AQI'
  assert.equal(publicOfflineEvidence(input), null)
})
test('F21 offline area identity normalizes Unicode and keeps different named/coordinate contexts apart', () => {
  const place = fixture().location
  assert.equal(
    offlineAreaKey({ ...place, name: ' Cafe\u0301 ' }),
    offlineAreaKey({ ...place, name: 'CAFÉ' }),
  )
  assert.notEqual(
    offlineAreaKey(place),
    offlineAreaKey({ ...place, name: 'Pune' }),
  )
  assert.notEqual(
    offlineAreaKey(place),
    offlineAreaKey({ ...place, latitude: 18.5 }),
  )
})
test('F21 dated planner navigation has shell fallback, while action/private/arbitrary queries do not', () => {
  for (const path of [
    '/',
    '/index.html',
    '/?date=2030-10-10#history',
    '/?date=2032-02-29',
  ])
    assert.equal(
      plannerShellNavigation(new URL(path, 'https://example.test')),
      true,
      path,
    )
  for (const path of [
    '/api/private',
    '/account',
    '/?display=1',
    '/?email-action=unsubscribe',
    '/?token=private',
    '/?date=2030-02-30',
    '/?date=2030-10-10&date=2030-10-11',
    '/?date=2030-10-10&lat=28.6',
  ])
    assert.equal(
      plannerShellNavigation(new URL(path, 'https://example.test')),
      false,
      path,
    )
})
test('F21 static precache excludes maps and paused optional feature chunks', () => {
  assert.equal(precacheAsset('App-123.js'), true)
  assert.equal(precacheAsset('index-123.css'), true)
  assert.equal(
    precacheAsset('R3-123.css'),
    true,
    'App imports this shared stylesheet even when optional controls are hidden',
  )
  for (const name of [
    'StationMap-123.js',
    'leaflet-123.css',
    'FireMap-123.js',
    'R3-123.js',
    'R4JourneyPanel-123.js',
    'R5DevicesPanel-123.js',
    'PublicDisplay-123.js',
    'Unsubscribe-123.js',
    'r4-journey-store-123.js',
  ])
    assert.equal(precacheAsset(name), false, name)
})

test('F21 public startup static dependencies are all precached in the actual build', async () => {
  const manifest = JSON.parse(
    await readFile('dist/.vite/manifest.json', 'utf8'),
  )
  const source = await readFile('dist/sw.js', 'utf8')
  const required = requiredShellAssets(manifest)
  // Shared CSS can be renamed or merged by Vite; check the manifest graph.
  assert.ok(required.some((path) => path.endsWith('.css')))
  for (const path of required)
    assert.ok(source.includes(JSON.stringify(path)), path)
  assert.throws(
    () => requiredShellAssets({ 'index.html': { file: 'entry.js' } }),
    /entries/,
  )
})

test('F21 generated worker serves dated shell and excludes private/API/auth/external/tile/query requests', async () => {
  const source = await readFile('dist/sw.js', 'utf8'),
    listeners = new Map(),
    cached = { shell: true },
    requests = []
  const context = {
    URL,
    Set,
    Promise,
    Request: class {
      constructor(url, options) {
        this.url = url
        this.cache = options?.cache
      }
    },
    self: {
      location: { origin: 'https://example.test' },
      addEventListener: (type, callback) => listeners.set(type, callback),
    },
    caches: {
      open: async () => ({
        match: async (key) => (key === '/index.html' ? cached : null),
        addAll: async (files) => requests.push(...files),
      }),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async (request) => ({ network: request.url }),
  }
  vm.runInNewContext(source, context)
  let install
  listeners.get('install')({ waitUntil: (p) => (install = p) })
  await install
  assert.ok(requests.length > 5)
  assert.ok(
    requests.every(
      (r) =>
        r.cache === 'reload' &&
        !r.url.startsWith('/api/') &&
        !/StationMap|leaflet|R4Journey|R5Devices/.test(r.url),
    ),
  )
  const event = (url, extra = {}) => {
    let response
    listeners.get('fetch')({
      request: {
        url: new URL(url, 'https://example.test').href,
        method: 'GET',
        mode: 'navigate',
        headers: new Headers(),
        ...extra,
      },
      respondWith: (p) => (response = p),
    })
    return response
  }
  assert.equal(await event('/?date=2030-10-10'), cached)
  for (const path of [
    '/api/workspace',
    '/?email-action=unsubscribe',
    '/?display=1',
    '/?auth=secret',
    'https://tile.openstreetmap.org/5/1/2.png',
  ])
    assert.equal(event(path), undefined)
  assert.equal(
    event('/', { headers: new Headers({ authorization: 'SYNTHETIC' }) }),
    undefined,
  )
  assert.equal(
    event('/assets/App.js?token=private', { mode: 'cors' }),
    undefined,
  )
  assert.equal(event('/', { method: 'POST' }), undefined)
  assert.ok(!/skipWaiting\s*\(|clients\.claim\s*\(/.test(source))
})
