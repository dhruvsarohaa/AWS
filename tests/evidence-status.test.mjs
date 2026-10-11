import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, areaFor, validateForecast } from '../api/core.mjs'
import { createEngine } from '../api/engine.mjs'
import { MemoryStore } from '../api/store.mjs'
import {
  fetchOpenAq,
  normalizeOpenAq,
  OPENAQ_SELECTION_VERSION,
} from '../api/providers.mjs'
import {
  coverageState,
  providerPresentation,
} from '../src/lib/evidence-status.ts'
import { MONITOR_MAX_AGE } from '../src/lib/planner.ts'
import { latest, location, place, rawForecast, sensor } from './fixtures.mjs'

// Only synthetic fixtures and injected requests are used; no live provider access.
const now = Date.parse('2026-10-08T08:00:00Z')
const successAt = new Date(now - 60_000).toISOString()
const attemptAt = new Date(now).toISOString()
const monitor = normalizeOpenAq(
  location,
  sensor,
  { ...latest(), datetime: { utc: successAt } },
  now - 30_000,
)
const forecast = validateForecast(rawForecast(), now)
const data = (overrides = {}) => ({
  location: place,
  forecast,
  monitors: [monitor],
  sources: {
    cpcb: { status: 'not_configured' },
    openaq: { status: 'live' },
  },
  ...overrides,
})
const engineFor = (store, options = {}) =>
  createEngine({
    store,
    request: async () => {
      throw new ApiError('Synthetic provider outage', 502)
    },
    keys: async () => ({}),
    enqueue: async () => {},
    archive: async () => {},
    ...options,
  })

test('a recent cached reading keeps failed retrieval, reason and original times visible', () => {
  const presentation = providerPresentation(
    {
      status: 'unavailable',
      message: 'Synthetic provider outage',
      lastSuccessAt: successAt,
      lastAttemptAt: attemptAt,
    },
    monitor,
    now,
  )
  assert.equal(presentation.retrievalLabel, 'Refresh failed')
  assert.equal(presentation.observationLabel, 'Recent reading')
  assert.equal(presentation.message, 'Synthetic provider outage')
  assert.equal(presentation.lastSuccessAt, successAt)
  assert.equal(presentation.lastAttemptAt, attemptAt)
  assert.equal(presentation.failed, true)
})

test('cached observations never replace disconnected, unverified or queued feed states', () => {
  for (const [status, label] of [
    ['not_configured', 'Not connected'],
    ['unverified', 'Metadata not verified'],
    ['pending', 'Retrieval queued'],
    ['no_data', 'No new nearby reading'],
  ]) {
    const presentation = providerPresentation(
      { status, message: `Synthetic ${status} reason` },
      monitor,
      now,
    )
    assert.equal(presentation.retrievalLabel, label)
    assert.equal(presentation.message, `Synthetic ${status} reason`)
    assert.equal(presentation.observationLabel, 'Recent reading')
  }
  assert.equal(
    providerPresentation({ status: 'pending' }, undefined, now)
      .observationLabel,
    null,
  )
})

test('the client clock updates both reading freshness and coverage at the same age boundary', () => {
  const snapshot = data({
    coverage: { state: 'forecast_and_observation' },
  })
  const boundary = Date.parse(monitor.observedAt) + MONITOR_MAX_AGE
  assert.equal(coverageState(snapshot, boundary), 'forecast_and_observation')
  assert.equal(
    providerPresentation({ status: 'live' }, monitor, boundary)
      .observationLabel,
    'Recent reading',
  )
  assert.equal(
    coverageState(snapshot, boundary + 1),
    'forecast_and_old_observation',
  )
  assert.equal(
    providerPresentation({ status: 'live' }, monitor, boundary + 1)
      .observationLabel,
    'Old observation',
  )
  assert.equal(snapshot.coverage.state, 'forecast_and_observation')
})

test('coverage and observation labels handle unverified times and empty evidence consistently', () => {
  for (const observedAt of [
    null,
    'not-a-date',
    new Date(now + 360_000).toISOString(),
  ]) {
    const row = { ...monitor, observedAt, stale: false }
    assert.equal(
      providerPresentation({ status: 'live' }, row, now).observationLabel,
      'Observation time unverified',
    )
    assert.equal(
      coverageState(data({ monitors: [row] }), now),
      'forecast_and_old_observation',
    )
  }
  assert.equal(coverageState(data({ monitors: [] }), now), 'forecast_only')
  assert.equal(
    coverageState(data({ forecast: null }), now),
    'observations_only',
  )
  assert.equal(
    coverageState(data({ forecast: null, monitors: [], pending: true }), now),
    'pending',
  )
  assert.equal(
    coverageState(data({ forecast: null, monitors: [], pending: false }), now),
    'unavailable',
  )
})

test('an engine outage preserves source reason, successful retrieval and cached evidence timestamps', async () => {
  const store = new MemoryStore()
  const area = areaFor(place)
  const priorAttempt = new Date(now - 10_000).toISOString()
  await store.put(
    `SOURCE#${area.id}`,
    'forecast',
    {
      value: { forecast },
      status: { status: 'live' },
      lastSuccessAt: successAt,
      lastAttemptAt: priorAttempt,
    },
    { refreshAt: 0 },
  )
  const engine = engineFor(store)
  await engine.refresh(area)
  const stored = (await store.get(`SOURCE#${area.id}`, 'forecast')).data
  assert.equal(stored.lastSuccessAt, successAt)
  assert.notEqual(stored.lastAttemptAt, priorAttempt)
  assert.equal(stored.value.forecast.fetchedAt, forecast.fetchedAt)
  const snapshot = await engine.dashboard(place, '2030-10-08')
  const reread = await engine.dashboard(place, '2030-10-08')
  assert.equal(snapshot.sources.forecast.status, 'unavailable')
  assert.equal(snapshot.sources.forecast.message, 'Synthetic provider outage')
  assert.equal(snapshot.sources.forecast.lastSuccessAt, successAt)
  assert.equal(snapshot.sources.forecast.lastAttemptAt, stored.lastAttemptAt)
  assert.equal(snapshot.forecast.fetchedAt, forecast.fetchedAt)
  assert.deepEqual(reread.sources.forecast, snapshot.sources.forecast)
})

test('unsupported retrieval retains previous observation and success time with its own feed status', async () => {
  const store = new MemoryStore()
  const area = areaFor(place)
  await store.put(`SOURCE#${area.id}`, 'openaq', {
    value: { monitors: [monitor] },
    status: { status: 'live' },
    lastSuccessAt: successAt,
  })
  await engineFor(store).refresh(area)
  const snapshot = await engineFor(store).dashboard(place, '2030-10-08')
  assert.equal(snapshot.sources.openaq.status, 'not_configured')
  assert.equal(
    snapshot.sources.openaq.message,
    'OpenAQ is not connected on this deployment.',
  )
  assert.equal(snapshot.sources.openaq.lastSuccessAt, successAt)
  assert.equal(snapshot.monitors[0].observedAt, monitor.observedAt)
  assert.equal(snapshot.monitors[0].fetchedAt, monitor.fetchedAt)
})

test('legacy cached rows derive successful time from evidence without stamping dashboard read time', async () => {
  const store = new MemoryStore()
  const area = areaFor(place)
  await store.put('CONTROL', 'current', { paused: true })
  await store.put(`SOURCE#${area.id}`, 'forecast', {
    value: { forecast },
    status: { status: 'unavailable', message: 'Previous synthetic outage' },
    lastAttemptAt: attemptAt,
  })
  await store.put(`SOURCE#${area.id}`, 'openaq', {
    value: { monitors: [monitor] },
    status: { status: 'live' },
  })
  const snapshot = await engineFor(store).dashboard(place, '2030-10-08')
  assert.equal(snapshot.sources.forecast.lastSuccessAt, forecast.fetchedAt)
  assert.equal(snapshot.sources.forecast.lastAttemptAt, attemptAt)
  assert.equal(snapshot.sources.openaq.lastSuccessAt, monitor.fetchedAt)
  assert.equal(snapshot.sources.openaq.lastAttemptAt, null)
})

test('a retrieval returning no readings preserves prior evidence and successful time', async () => {
  const store = new MemoryStore()
  const area = areaFor(place)
  await store.put(`REGISTRY#${area.id}`, 'current', {
    locations: [],
    fetchedAt: Date.now(),
    selectionVersion: OPENAQ_SELECTION_VERSION,
  })
  await store.put(
    `SOURCE#${area.id}`,
    'forecast',
    { value: { forecast }, status: { status: 'live' } },
    { refreshAt: Date.now() + 60_000 },
  )
  await store.put(`SOURCE#${area.id}`, 'openaq', {
    value: { monitors: [monitor] },
    status: { status: 'live' },
    lastSuccessAt: successAt,
  })
  const engine = engineFor(store, {
    keys: async () => ({ OPENAQ_API_KEY: 'synthetic-offline-fixture' }),
  })
  await engine.refresh(area)
  const snapshot = await engine.dashboard(place, '2030-10-08')
  assert.equal(snapshot.sources.openaq.status, 'no_data')
  assert.match(snapshot.sources.openaq.message, /No usable stationary PM2.5/)
  assert.equal(snapshot.sources.openaq.lastSuccessAt, successAt)
  assert.equal(snapshot.monitors[0].fetchedAt, monitor.fetchedAt)
})

test('shared forecast cache retains its retrieval time when another area uses it', async () => {
  const store = new MemoryStore()
  const area = areaFor(place)
  const sharedForecast = validateForecast(rawForecast(), Date.now() - 60_000)
  await store.put(`GRID_ALIAS#${area.id}`, 'current', { id: 'synthetic-grid' })
  await store.put('GRID#synthetic-grid', 'current', {
    forecast: sharedForecast,
    status: { status: 'live' },
  })
  const engine = engineFor(store)
  await engine.refresh(area)
  const snapshot = await engine.dashboard(place, '2030-10-08')
  assert.equal(snapshot.sources.forecast.status, 'live')
  assert.equal(snapshot.forecast.fetchedAt, sharedForecast.fetchedAt)
  assert.equal(
    snapshot.sources.forecast.lastSuccessAt,
    sharedForecast.fetchedAt,
  )
})

test('cached OpenAQ readings survive a station retrieval failure while the feed stays failed', async () => {
  const store = new MemoryStore()
  const area = areaFor(place)
  const recent = normalizeOpenAq(location, sensor, latest())
  await store.put(`REGISTRY#${area.id}`, 'current', {
    locations: [location],
    fetchedAt: Date.now(),
    selectionVersion: OPENAQ_SELECTION_VERSION,
  })
  await store.put(`LATEST#${location.id}`, 'current', [recent], {
    refreshAt: 0,
  })
  const result = await fetchOpenAq(
    area,
    async () => {
      throw new ApiError('Synthetic station outage', 502)
    },
    store,
    { OPENAQ_API_KEY: 'synthetic-offline-fixture' },
  )
  assert.equal(result.status.status, 'unavailable')
  assert.match(result.status.message, /1 station request failed/)
  assert.equal(result.monitors[0].fetchedAt, recent.fetchedAt)
  const presentation = providerPresentation(
    result.status,
    result.monitors[0],
    Date.now(),
  )
  assert.equal(presentation.failed, true)
  assert.equal(presentation.observationLabel, 'Recent reading')
})

test('station outages remain failed on dashboard reads with usable recent cached observations', async () => {
  const store = new MemoryStore()
  const area = areaFor(place)
  const recent = normalizeOpenAq(location, sensor, latest())
  await store.put(`REGISTRY#${area.id}`, 'current', {
    locations: [location],
    fetchedAt: Date.now(),
    selectionVersion: OPENAQ_SELECTION_VERSION,
  })
  await store.put(`LATEST#${location.id}`, 'current', [recent], {
    refreshAt: 0,
  })
  await store.put(`SOURCE#${area.id}`, 'openaq', {
    value: { monitors: [recent] },
    status: { status: 'live' },
    lastSuccessAt: recent.fetchedAt,
  })
  const engine = engineFor(store, {
    keys: async () => ({ OPENAQ_API_KEY: 'synthetic-offline-fixture' }),
  })
  await engine.refresh(area)
  const snapshot = await engine.dashboard(place, '2030-10-08')
  assert.equal(snapshot.sources.openaq.status, 'unavailable')
  assert.match(snapshot.sources.openaq.message, /1 station request failed/)
  assert.equal(snapshot.sources.openaq.lastSuccessAt, recent.fetchedAt)
  assert.equal(snapshot.monitors[0].fetchedAt, recent.fetchedAt)
  assert.equal(
    providerPresentation(
      snapshot.sources.openaq,
      snapshot.monitors[0],
      Date.now(),
    ).observationLabel,
    'Recent reading',
  )
  assert.equal(snapshot.coverage.state, 'observations_only')
})

test('quality flag metadata failure stays distinct from successful station reading retrieval', async () => {
  const store = new MemoryStore()
  const area = areaFor(place)
  await store.put(`REGISTRY#${area.id}`, 'current', {
    locations: [location],
    fetchedAt: Date.now(),
    selectionVersion: OPENAQ_SELECTION_VERSION,
  })
  const result = await fetchOpenAq(
    area,
    async (_provider, url) => {
      if (url.pathname.endsWith('/latest')) return { results: [latest()] }
      throw new ApiError('Synthetic quality flags outage', 502)
    },
    store,
    { OPENAQ_API_KEY: 'synthetic-offline-fixture' },
  )
  assert.equal(result.status.status, 'live')
  assert.equal(result.monitors[0].qualityStatus, 'unavailable')
})

test('a first partial failed station retrieval keeps completed-success time unknown', async () => {
  const store = new MemoryStore()
  const area = areaFor(place)
  const failedLocation = {
    ...location,
    id: 2,
    name: 'SYNTHETIC FAILED STATION',
  }
  await store.put(`REGISTRY#${area.id}`, 'current', {
    locations: [location, failedLocation],
    fetchedAt: Date.now(),
    selectionVersion: OPENAQ_SELECTION_VERSION,
  })
  const engine = engineFor(store, {
    keys: async () => ({ OPENAQ_API_KEY: 'synthetic-offline-fixture' }),
    request: async (provider, url) => {
      if (provider === 'openmeteo') return rawForecast()
      if (url.pathname === '/v3/locations/1/latest')
        return { results: [latest()] }
      if (url.pathname === '/v3/locations/2/latest')
        throw new ApiError('Synthetic second station outage', 502)
      return { results: [] }
    },
  })
  await engine.refresh(area)
  const stored = (await store.get(`SOURCE#${area.id}`, 'openaq')).data
  assert.equal(stored.status.status, 'unavailable')
  assert.equal(stored.value.monitors.length, 1)
  assert.ok(stored.value.monitors[0].fetchedAt)
  assert.equal(stored.lastSuccessAt, null)
  const snapshot = await engine.dashboard(place, '2030-10-08')
  const reread = await engine.dashboard(place, '2030-10-08')
  assert.equal(snapshot.sources.openaq.status, 'unavailable')
  assert.equal(snapshot.sources.openaq.lastSuccessAt, null)
  assert.equal(reread.sources.openaq.lastSuccessAt, null)
  assert.equal(
    snapshot.monitors[0].fetchedAt,
    stored.value.monitors[0].fetchedAt,
  )
})
