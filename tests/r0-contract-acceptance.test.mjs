import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validDashboard,
  validDashboardForPlace,
  validMonitor,
} from '../src/lib/contracts.ts'
import { validateForecast } from '../api/core.mjs'
import { rawForecast } from './fixtures.mjs'
const place = {
  name: 'Fixture Delhi',
  state: 'Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
}
const monitor = {
  source: 'OpenAQ',
  station: 'SYNTHETIC',
  pollutant: 'PM2.5',
  unit: 'µg/m³',
  value: 0,
  observedAt: null,
  stale: true,
  url: 'https://openaq.org',
}
const data = () => ({
  schemaVersion: 2,
  snapshotId: 'a'.repeat(32),
  location: place,
  forecast: validateForecast(rawForecast()),
  monitors: [monitor],
  sources: { openaq: { status: 'live' }, cpcb: { status: 'not_configured' } },
})
test('R0: dashboard is bound to requested place; a different forecast grid is allowed', () => {
  assert.equal(validDashboardForPlace(data(), place), true)
  for (const change of [
    { latitude: 18.52 },
    { longitude: 73.85 },
    { name: 'Pune' },
    { state: 'Maharashtra' },
  ])
    assert.equal(
      validDashboardForPlace(
        { ...data(), location: { ...place, ...change } },
        place,
      ),
      false,
    )
  assert.equal(
    validDashboardForPlace(
      { ...data(), location: { ...place, name: ' fixture DELHI ' } },
      place,
    ),
    true,
  )
  assert.equal(
    validDashboard({ ...data(), location: { ...place, country: 'Pakistan' } }),
    false,
  )
})
test('R0: monitor zero and unknown position remain valid; corrupt coordinates and units fail closed', () => {
  assert.equal(validMonitor(monitor), true)
  assert.equal(
    validMonitor({ ...monitor, latitude: null, longitude: null }),
    true,
  )
  assert.equal(
    validMonitor({ ...monitor, latitude: 28.6, longitude: 77.2 }),
    true,
  )
  for (const change of [
    { latitude: 28.6 },
    { latitude: NaN, longitude: 77.2 },
    { latitude: 91, longitude: 77.2 },
    { latitude: 28.6, longitude: 181 },
    { latitude: '28.6', longitude: 77.2 },
    { unit: 'AQI' },
    { value: -1 },
  ])
    assert.equal(validMonitor({ ...monitor, ...change }), false)
})
test('R0: malformed nested evidence cannot enter charts or the offline cache', () => {
  for (const change of [
    { snapshotId: 'fake' },
    { forecast: { ...data().forecast, timezone: 'UTC' } },
    {
      forecast: {
        ...data().forecast,
        points: [{ time: '2030-10-08T08:00:00+05:30', pm25: NaN, pm10: 55 }],
      },
    },
    { monitors: [{ ...monitor, url: 'javascript:alert(1)' }] },
    { sources: { openaq: { status: 'invented' }, cpcb: { status: 'live' } } },
  ])
    assert.equal(validDashboardForPlace({ ...data(), ...change }, place), false)
})
