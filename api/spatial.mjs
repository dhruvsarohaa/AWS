import { distanceKm, sourceAge, timestamp } from './core.mjs'
import { readFile } from 'node:fs/promises'
const mappings = JSON.parse(
  await readFile(
    new URL('./config/station-mappings.json', import.meta.url),
    'utf8',
  ),
)
const tile = (lat, lon) => [Math.floor(lat * 2), Math.floor(lon * 2)]
export function stationCapacity(
  value = process.env.AIRDAY_MAX_ACTIVE_STATIONS,
) {
  if (value === undefined || value === '') return 20
  if (typeof value !== 'string' || !/^(?:[23]\d|40)$/.test(value))
    throw new Error('Active-station capacity must be an integer from 20 to 40.')
  return Number(value)
}
export function stationIdentity(monitor) {
  const match = mappings.records.find(
    (row) =>
      row.source === monitor.source &&
      row.providerStationId === monitor.providerStationId &&
      row.reviewedBy &&
      timestamp(row.reviewedAt) &&
      row.evidenceUrl?.startsWith('https://'),
  )
  return match
    ? {
        ...monitor,
        canonicalStationId: match.canonicalStationId,
        originId: match.originId || monitor.originId,
        identityReview: match.evidenceUrl,
      }
    : monitor
}
export async function indexStations(store, monitors) {
  for (const input of monitors) {
    const monitor = stationIdentity(input),
      [lat, lon] = tile(monitor.latitude, monitor.longitude)
    await store.put(
      `TILE#${lat},${lon}`,
      `${monitor.source}#${monitor.providerStationId}#${monitor.sensorId || 'pm25'}`,
      monitor,
      { expireAt: Math.floor(Date.now() / 1000) + 7 * 86400 },
    )
  }
}
export async function nearbyStations(store, place) {
  const [lat, lon] = tile(place.latitude, place.longitude),
    keys = []
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) keys.push(`TILE#${lat + a},${lon + b}`)
  const rows = (
    await Promise.all(keys.map((key) => store.list(key, 100)))
  ).flat()
  return rows
    .filter((row) => row.expireAt > Date.now() / 1000)
    .map(({ data }) => ({
      ...data,
      distanceKm: distanceKm(
        place.latitude,
        place.longitude,
        data.latitude,
        data.longitude,
      ),
      stale: sourceAge(data.observedAt) !== 'current',
    }))
    .filter((row) => row.distanceKm <= 25)
}
export async function admitStation(store, id) {
  const capacity = stationCapacity()
  const existing = await store.get('STATIONS', id),
    expiry = Math.floor(Date.now() / 1000) + 86400
  if (existing?.expireAt > Date.now() / 1000) {
    await store.put('STATIONS', id, existing.data, { expireAt: expiry })
    return true
  }
  if (!(await store.claim('STATION_ADMISSION', 10))) return false
  try {
    if (
      (await store.list('STATIONS', 100)).filter(
        (row) => row.expireAt > Date.now() / 1000,
      ).length >= capacity
    )
      return false
    await store.put(
      'STATIONS',
      id,
      { provider: 'OpenAQ' },
      { expireAt: expiry },
    )
    return true
  } finally {
    await store.delete('STATION_ADMISSION', 'lock')
  }
}
