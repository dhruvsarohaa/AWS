import type { DashboardData, Monitor, Place, SourceStatus } from '../types.ts'
const object = (x: unknown): x is Record<string, unknown> =>
  Boolean(x && typeof x === 'object' && !Array.isArray(x))
const text = (x: unknown, max = 2000): x is string =>
  typeof x === 'string' && x.length <= max
const finite = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x)
const nullableNumber = (x: unknown) => x === null || (finite(x) && x >= 0)
const timestamp = (x: unknown) => text(x, 60) && Number.isFinite(Date.parse(x))
const nullableTime = (x: unknown) => x == null || timestamp(x)
const optionalText = (x: unknown, max = 500) => x == null || text(x, max)
const optionalBool = (x: unknown) => x === undefined || typeof x === 'boolean'
export const validPlace = (x: unknown): x is Place =>
  object(x) &&
  text(x.name, 200) &&
  text(x.state, 200) &&
  x.country === 'India' &&
  finite(x.latitude) &&
  finite(x.longitude) &&
  x.latitude >= 6 &&
  x.latitude <= 38 &&
  x.longitude >= 68 &&
  x.longitude <= 98 &&
  optionalBool(x.confirmed) &&
  optionalBool(x.detected) &&
  (x.accuracyMeters === undefined ||
    (finite(x.accuracyMeters) && x.accuracyMeters >= 0)) &&
  nullableTime(x.detectedAt)
const url = (x: unknown) => {
  if (!text(x)) return false
  try {
    const u = new URL(x)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}
const source = (x: unknown): x is SourceStatus =>
  object(x) &&
  [
    'live',
    'stale',
    'not_configured',
    'unavailable',
    'no_data',
    'pending',
    'unverified',
  ].includes(String(x.status)) &&
  (x.message === undefined || text(x.message)) &&
  nullableTime(x.lastAttemptAt) &&
  nullableTime(x.lastSuccessAt)
export const validMonitor = (x: unknown): x is Monitor =>
  object(x) &&
  ['OpenAQ', 'CPCB / data.gov.in'].includes(String(x.source)) &&
  text(x.station, 300) &&
  [
    'city',
    'state',
    'owner',
    'upstreamProvider',
    'statistic',
    'qualityStatus',
    'id',
    'providerStationId',
    'sensorId',
    'canonicalStationId',
    'originId',
  ].every((key) => optionalText(x[key])) &&
  finite(x.value) &&
  x.value >= 0 &&
  x.pollutant === 'PM2.5' &&
  ['µg/m³', 'μg/m³', 'ug/m3', 'µg/m3', 'μg/m3'].includes(String(x.unit)) &&
  nullableTime(x.observedAt) &&
  typeof x.stale === 'boolean' &&
  url(x.url) &&
  ((x.latitude == null && x.longitude == null) ||
    (finite(x.latitude) &&
      finite(x.longitude) &&
      Math.abs(x.latitude) <= 90 &&
      Math.abs(x.longitude) <= 180)) &&
  (x.distanceKm == null || nullableNumber(x.distanceKm)) &&
  (x.qualityFlags === undefined || Array.isArray(x.qualityFlags)) &&
  (x.referenceMonitor == null || typeof x.referenceMonitor === 'boolean') &&
  (x.instruments === undefined ||
    (Array.isArray(x.instruments) &&
      x.instruments.length <= 5 &&
      x.instruments.every((name) => text(name, 200)))) &&
  (x.siting === undefined || x.siting === 'not_verified') &&
  (x.period == null ||
    (object(x.period) &&
      timestamp(x.period.start) &&
      timestamp(x.period.end) &&
      Date.parse(String(x.period.end)) > Date.parse(String(x.period.start))))
/** Reject malformed nested responses before they reach charts, links or journal creation. */
export function validDashboard(x: unknown): x is DashboardData {
  if (
    !object(x) ||
    !optionalBool(x.pending) ||
    !optionalBool(x.ingestionPaused) ||
    !optionalText(x.ingestionWarning) ||
    x.schemaVersion !== 2 ||
    !text(x.snapshotId, 32) ||
    !/^[a-f0-9]{32}$/.test(x.snapshotId) ||
    !validPlace(x.location) ||
    !text(x.location.name, 200) ||
    !text(x.location.state, 200) ||
    !text(x.location.country, 100) ||
    !finite(x.location.latitude) ||
    !finite(x.location.longitude) ||
    x.location.latitude < 6 ||
    x.location.latitude > 38 ||
    x.location.longitude < 68 ||
    x.location.longitude > 98 ||
    !Array.isArray(x.monitors) ||
    x.monitors.length > 10 ||
    !x.monitors.every(validMonitor) ||
    (x.nearbyMonitors !== undefined &&
      (!Array.isArray(x.nearbyMonitors) ||
        x.nearbyMonitors.length > 10 ||
        !x.nearbyMonitors.every(validMonitor))) ||
    !object(x.sources) ||
    !source(x.sources.cpcb) ||
    !source(x.sources.openaq) ||
    (x.sources.forecast !== undefined && !source(x.sources.forecast))
  )
    return false
  if (x.forecast !== null) {
    const f = x.forecast
    if (
      !object(f) ||
      !timestamp(f.fetchedAt) ||
      !optionalText(f.id, 100) ||
      !nullableTime(f.issuedAt) ||
      !['Asia/Kolkata', 'Asia/Calcutta'].includes(String(f.timezone)) ||
      !object(f.grid) ||
      !finite(f.grid.latitude) ||
      !finite(f.grid.longitude) ||
      Math.abs(f.grid.latitude) > 90 ||
      Math.abs(f.grid.longitude) > 180 ||
      !text(f.source, 500) ||
      !Array.isArray(f.points) ||
      f.points.length > 240
    )
      return false
    let previous = -Infinity
    for (const p of f.points) {
      if (
        !object(p) ||
        !timestamp(p.time) ||
        !/\+05:30$/.test(String(p.time)) ||
        !nullableNumber(p.pm25) ||
        !nullableNumber(p.pm10) ||
        Date.parse(String(p.time)) <= previous
      )
        return false
      previous = Date.parse(String(p.time))
    }
    if (f.pollutants !== undefined) {
      if (
        !object(f.pollutants) ||
        Object.keys(f.pollutants).some(
          (k) => !['pm25', 'pm10', 'no2', 'o3', 'so2', 'co'].includes(k),
        )
      )
        return false
      for (const s of Object.values(f.pollutants)) {
        if (
          !object(s) ||
          s.schemaVersion !== 1 ||
          s.unit !== 'µg/m³' ||
          !text(s.source, 500) ||
          s.source !== f.source ||
          s.statistic !== 'model_sample' ||
          s.stepMinutes !== 60 ||
          !Array.isArray(s.values) ||
          s.values.length !== f.points.length
        )
          return false
        if (
          !s.values.every(
            (v, i) =>
              object(v) &&
              v.time === (f.points as { time: string }[])[i].time &&
              nullableNumber(v.value),
          )
        )
          return false
      }
      for (const key of ['pm25', 'pm10']) {
        const s = f.pollutants[key]
        if (
          object(s) &&
          Array.isArray(s.values) &&
          !s.values.every(
            (v, i) =>
              object(v) &&
              v.value === (f.points as Record<string, unknown>[])[i][key],
          )
        )
          return false
      }
    }
  }
  if (x.policy !== undefined) {
    const p = x.policy
    if (
      !object(p) ||
      !text(p.date, 10) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.date) ||
      !text(p.version, 100) ||
      !text(p.status, 100) ||
      !text(p.message) ||
      !Array.isArray(p.records) ||
      p.records.length > 100 ||
      !p.records.every(
        (r) =>
          object(r) &&
          text(r.id, 100) &&
          text(r.title, 500) &&
          url(r.url) &&
          timestamp(r.reviewedAt) &&
          (r.instruction === undefined || text(r.instruction)),
      ) ||
      !Array.isArray(p.sources) ||
      !p.sources.every((r) => object(r) && text(r.name, 300) && url(r.url))
    )
      return false
  }
  if (
    x.coverage !== undefined &&
    (!object(x.coverage) ||
      !text(x.coverage.state, 100) ||
      !finite(x.coverage.returnedStationCount) ||
      !nullableNumber(x.coverage.nearestDistanceKm) ||
      !finite(x.coverage.searchRadiusKm) ||
      !text(x.coverage.message))
  )
    return false
  if (
    x.comparison != null &&
    (!object(x.comparison) ||
      typeof x.comparison.eligible !== 'boolean' ||
      typeof x.comparison.sharedOrigin !== 'boolean' ||
      !Array.isArray(x.comparison.reasons) ||
      !x.comparison.reasons.every((r) => text(r)) ||
      !text(x.comparison.message))
  )
    return false
  return true
}

/** The response must describe the requested place, not merely a valid Indian place.
 * Forecast grid coordinates may differ; they are intentionally not compared here. */
export function validDashboardForPlace(
  value: unknown,
  selected: Place,
): value is DashboardData {
  if (!validDashboard(value)) return false
  const normalize = (text: string) => text.trim().normalize('NFC').toLowerCase()
  return (
    value.location.latitude === selected.latitude &&
    value.location.longitude === selected.longitude &&
    normalize(value.location.name) === normalize(selected.name) &&
    normalize(value.location.state) === normalize(selected.state)
  )
}
