// Bounded, read-only provider diagnostic. Never prints secrets or raw errors.
// Location datetimeLast may describe another pollutant; latest checks verify PM2.5.
import { mkdir, writeFile } from 'node:fs/promises'
import { distanceKm } from '../api/core.mjs'

try {
  process.loadEnvFile()
} catch (error) {
  if (error.code !== 'ENOENT')
    throw new Error('Local secret configuration could not be loaded.')
}
if (!process.env.OPENAQ_API_KEY) {
  console.log(JSON.stringify({ status: 'not_configured' }))
  process.exit(1)
}
const places = [
  { city: 'New Delhi', latitude: 28.6139, longitude: 77.209 },
  { city: 'Noida', latitude: 28.5355, longitude: 77.391 },
  { city: 'Gurugram', latitude: 28.4595, longitude: 77.0266 },
  { city: 'Mumbai', latitude: 19.076, longitude: 72.8777 },
  { city: 'Bengaluru', latitude: 12.9716, longitude: 77.5946 },
]
let calls = 0
async function request(path, parameters = {}) {
  if (++calls > 8) throw new Error('Diagnostic call budget exhausted.')
  const url = new URL(path, 'https://api.openaq.org')
  for (const [key, value] of Object.entries(parameters))
    url.searchParams.set(key, value)
  try {
    const response = await fetch(url, {
      headers: {
        'X-API-Key': process.env.OPENAQ_API_KEY,
        accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return { status: response.status, results: [] }
    const payload = await response.json()
    return {
      status: response.status,
      meta: payload.meta,
      results: Array.isArray(payload.results) ? payload.results : [],
    }
  } catch {
    return { status: 'request_failed', results: [] }
  }
}
const now = new Date().toISOString()
const catalogs = []
for (const place of places) {
  // Match the application's rounded ingestion center and 25 km search.
  const center = {
    latitude: Math.round(place.latitude * 10) / 10,
    longitude: Math.round(place.longitude * 10) / 10,
  }
  const response = await request('/v3/locations', {
    coordinates: `${center.latitude},${center.longitude}`,
    radius: 25000,
    parameters_id: 2,
    iso: 'IN',
    mobile: false,
    limit: 1000,
  })
  const locations = response.results
    .filter((row) => row.country?.code === 'IN' && row.isMobile === false)
    .map((row) => ({
      id: row.id,
      station: row.name,
      locality: row.locality,
      coordinates: row.coordinates,
      stationary: !row.isMobile,
      referenceMonitor: row.isMonitor,
      upstreamProvider: row.provider?.name,
      owner: row.owner?.name,
      firstObservation: row.datetimeFirst?.utc,
      lastObservationAnyPollutant: row.datetimeLast?.utc,
      pm25Sensors: (row.sensors || [])
        .filter((sensor) => sensor.parameter?.name === 'pm25')
        .map((sensor) => ({
          id: sensor.id,
          name: sensor.name,
          unit: sensor.parameter?.units,
        })),
      distanceKm: distanceKm(
        place.latitude,
        place.longitude,
        row.coordinates?.latitude,
        row.coordinates?.longitude,
      ),
      distanceFromRoundedCenterKm: distanceKm(
        center.latitude,
        center.longitude,
        row.coordinates?.latitude,
        row.coordinates?.longitude,
      ),
    }))
    .filter((row) => row.pm25Sensors.length)
    .sort(
      (a, b) => a.distanceFromRoundedCenterKm - b.distanceFromRoundedCenterKm,
    )
  catalogs.push({
    place,
    center,
    fetchedAt: new Date().toISOString(),
    status: response.status,
    found: response.meta?.found,
    returned: response.results.length,
    truncated: Number(response.meta?.found) > response.results.length,
    locations,
  })
}
const delhi = catalogs[0]
const freshestDelhi = [...delhi.locations]
  .filter((row) => row.distanceKm <= 25)
  .sort(
    (a, b) =>
      Date.parse(b.lastObservationAnyPollutant || '') -
      Date.parse(a.lastObservationAnyPollutant || ''),
  )
  .slice(0, 3)
const latestChecks = []
for (const location of freshestDelhi) {
  const response = await request(`/v3/locations/${location.id}/latest`)
  const ids = new Map(location.pm25Sensors.map((sensor) => [sensor.id, sensor]))
  latestChecks.push({
    city: 'New Delhi',
    station: location.station,
    id: location.id,
    distanceKm: location.distanceKm,
    originalDistanceRank:
      delhi.locations.findIndex((row) => row.id === location.id) + 1,
    fetchedAt: new Date().toISOString(),
    status: response.status,
    measurements: response.results
      .filter((row) => ids.has(row.sensorsId))
      .map((row) => ({
        sensorId: row.sensorsId,
        value: row.value,
        unit: ids.get(row.sensorsId).unit,
        observedAt: row.datetime?.utc,
        period: null,
        statistic: 'unknown',
      })),
  })
}
const report = {
  generatedAt: now,
  calls,
  radiusKm: 25,
  limits:
    'Five location catalogs and at most three latest checks. Catalog timestamps are not PM2.5-specific. Latest period is unknown.',
  catalogs,
  latestChecks,
}
await mkdir('artifacts', { recursive: true })
await writeFile(
  'artifacts/live-provider-coverage.json',
  JSON.stringify(report, null, 2),
)
console.log(
  JSON.stringify(
    {
      generatedAt: now,
      calls,
      catalogs: catalogs.map((catalog) => ({
        city: catalog.place.city,
        status: catalog.status,
        found: catalog.found,
        returned: catalog.returned,
        pm25Locations: catalog.locations.length,
        truncated: catalog.truncated,
        recentAnyPollutant: catalog.locations.filter(
          (row) =>
            Number.isFinite(Date.parse(row.lastObservationAnyPollutant)) &&
            Date.parse(now) - Date.parse(row.lastObservationAnyPollutant) <=
              3 * 3600000,
        ).length,
        nearestFive: catalog.locations
          .slice(0, 5)
          .map((row) => ({
            id: row.id,
            station: row.station,
            lastObservationAnyPollutant: row.lastObservationAnyPollutant,
          })),
      })),
      latestChecks,
      artifact: 'artifacts/live-provider-coverage.json',
    },
    null,
    2,
  ),
)
