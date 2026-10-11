import type { DashboardData, Monitor } from '../types.ts'
import { validDashboard, validMonitor } from './contracts.ts'
const validDate = (date: unknown): date is string =>
  typeof date === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(`${date}T12:00:00Z`)) &&
  new Date(`${date}T12:00:00Z`).toISOString().startsWith(date)
export function validHistoryRange(from: string, to: string) {
  return (
    validDate(from) &&
    validDate(to) &&
    to >= from &&
    Date.parse(to) - Date.parse(from) <= 30 * 86400000
  )
}
/** Current returned cards and nearby catalog may differ. Preserve both, but never
 * offer duplicate sensors or a unit the observation-period API cannot compare. */
export function historySensors(data: DashboardData): Monitor[] {
  const unique = new Map<string, Monitor>()
  for (const m of [...(data.nearbyMonitors || []), ...data.monitors])
    if (
      m.source === 'OpenAQ' &&
      /^\d{1,15}$/.test(m.sensorId || '') &&
      m.unit === 'µg/m³' &&
      Number.isFinite(m.latitude) &&
      Number.isFinite(m.longitude) &&
      (() => {
        const rad = (n: number) => (n * Math.PI) / 180
        const term =
          Math.sin(rad(m.latitude! - data.location.latitude) / 2) ** 2 +
          Math.cos(rad(m.latitude!)) *
            Math.cos(rad(data.location.latitude)) *
            Math.sin(rad(m.longitude! - data.location.longitude) / 2) ** 2
        return (
          6371 *
            2 *
            Math.atan2(
              Math.sqrt(Math.min(1, term)),
              Math.sqrt(Math.max(0, 1 - term)),
            ) <=
          25
        )
      })() &&
      !unique.has(m.sensorId!)
    )
      unique.set(m.sensorId!, m)
  return [...unique.values()]
}
export type RetainedRun = {
  id: string
  retrievedAt: string
  issuedAt: string | null
  source: string
  grid: { latitude: number; longitude: number }
  firstValidAt: string | null
  lastValidAt: string | null
}
export type HistoryPage = {
  areaId: string
  schemaVersion: 1
  kind: 'runs' | 'forecast' | 'observations'
  from: string
  to: string
  retrievedAt: string
  nextCursor: string | null
  runs?: RetainedRun[]
  run?: RetainedRun
  forecast?: NonNullable<DashboardData['forecast']>
  observations?: Monitor[]
  station?: {
    station: string
    sensorId: string
    source: string
    unit: string
    url: string
  }
  status?: { status: string; checkedAt?: string; message?: string } | null
}
export function validHistory(
  x: unknown,
  base: DashboardData,
  kind: HistoryPage['kind'],
  from: string,
  to: string,
): x is HistoryPage {
  if (!x || typeof x !== 'object') return false
  const v = x as HistoryPage
  const time = (s: unknown) =>
      typeof s === 'string' &&
      validDate(s.slice(0, 10)) &&
      /T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(
        s,
      ) &&
      Number.isFinite(Date.parse(s)),
    text = (s: unknown, max = 500) => typeof s === 'string' && s.length <= max
  const run = (r: RetainedRun) =>
    !!r &&
    /^[a-f0-9]{32}$/.test(r.id) &&
    time(r.retrievedAt) &&
    (r.issuedAt === null || time(r.issuedAt)) &&
    text(r.source) &&
    r.grid &&
    Number.isFinite(r.grid.latitude) &&
    Math.abs(r.grid.latitude) <= 90 &&
    Number.isFinite(r.grid.longitude) &&
    Math.abs(r.grid.longitude) <= 180 &&
    (r.firstValidAt === null || time(r.firstValidAt)) &&
    (r.lastValidAt === null || time(r.lastValidAt)) &&
    ((r.firstValidAt === null && r.lastValidAt === null) ||
      (r.firstValidAt !== null &&
        r.lastValidAt !== null &&
        Date.parse(r.firstValidAt) <= Date.parse(r.lastValidAt)))
  if (
    !validHistoryRange(from, to) ||
    v.areaId !==
      `${(Math.round(base.location.latitude * 10) / 10).toFixed(1)},${(Math.round(base.location.longitude * 10) / 10).toFixed(1)}` ||
    v.schemaVersion !== 1 ||
    v.kind !== kind ||
    v.from !== from ||
    v.to !== to ||
    !time(v.retrievedAt) ||
    (v.nextCursor !== null && !text(v.nextCursor, 800))
  )
    return false
  if (
    v.status != null &&
    (!text(v.status.status, 100) ||
      (v.status.message !== undefined && !text(v.status.message)) ||
      (v.status.checkedAt !== undefined && !time(v.status.checkedAt)))
  )
    return false
  if (kind === 'runs')
    return (
      Array.isArray(v.runs) &&
      v.runs.length <= 50 &&
      new Set(v.runs.map((r) => r?.id)).size === v.runs.length &&
      v.runs.every(
        (r) =>
          run(r) &&
          Date.parse(r.retrievedAt) >= Date.parse(`${from}T00:00:00+05:30`) &&
          Date.parse(r.retrievedAt) <= Date.parse(`${to}T23:59:59.999+05:30`),
      )
    )
  if (kind === 'forecast')
    return (
      !!v.forecast &&
      !!v.run &&
      run(v.run) &&
      validDashboard({ ...base, forecast: v.forecast }) &&
      v.forecast.id === v.run.id &&
      v.forecast.source === v.run.source &&
      v.forecast.grid.latitude === v.run.grid.latitude &&
      v.forecast.grid.longitude === v.run.grid.longitude &&
      (v.forecast.issuedAt ?? null) === v.run.issuedAt &&
      v.forecast.points.every(
        (p) => p.time.slice(0, 10) >= from && p.time.slice(0, 10) <= to,
      )
    )
  return (
    Array.isArray(v.observations) &&
    v.observations.length <= 500 &&
    new Set(v.observations.map((m) => m?.id)).size === v.observations.length &&
    v.observations.every(
      (m) =>
        validMonitor(m) &&
        m.source === 'OpenAQ' &&
        m.statistic === 'mean' &&
        m.pollutant === 'PM2.5' &&
        m.sensorId === v.station?.sensorId &&
        m.unit === v.station?.unit &&
        m.url === v.station?.url &&
        !!m.period &&
        !!m.observedAt &&
        Date.parse(m.observedAt) === Date.parse(m.period.end) &&
        Date.parse(m.observedAt) >= Date.parse(`${from}T00:00:00+05:30`) &&
        Date.parse(m.observedAt) <= Date.parse(`${to}T23:59:59.999+05:30`) &&
        (!('firstFetchedAt' in m) || time(m.firstFetchedAt)) &&
        (!('lastSeenAt' in m) || time(m.lastSeenAt)),
    ) &&
    !!v.station &&
    text(v.station.station, 300) &&
    /^\d{1,15}$/.test(v.station.sensorId) &&
    v.station.source === 'OpenAQ' &&
    v.station.unit === 'µg/m³' &&
    /^https:\/\/explore\.openaq\.org\/locations\/\d+$/.test(v.station.url) &&
    (v.status == null ||
      (text(v.status.status, 100) &&
        (v.status.message === undefined || text(v.status.message)) &&
        (v.status.checkedAt === undefined || time(v.status.checkedAt))))
  )
}
