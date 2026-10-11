import type { DashboardData, Monitor, Place, SourceStatus } from '../types.ts'
import { validDashboard } from './contracts.ts'

function pick<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Pick<T, K> {
  return Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  ) as Pick<T, K>
}

export function offlineAreaKey(place: Place) {
  return `${Math.round(place.latitude * 10) / 10}:${Math.round(place.longitude * 10) / 10}:${place.name.trim().normalize('NFC').toLowerCase()}:${place.state.trim().normalize('NFC').toLowerCase()}`
}

/** Cached clocks describe earlier evidence, never a new provider verification. */
export function offlineDashboard(
  data: DashboardData,
  confirmed?: boolean,
): DashboardData {
  const retained = publicOfflineEvidence(data)
  if (!retained) throw new Error('Unsupported offline evidence.')
  const status = (source: SourceStatus) =>
    ['not_configured', 'unverified'].includes(source.status)
      ? source
      : {
          ...source,
          status: 'unavailable' as const,
          message:
            'Cached public evidence. No network verification; original retrieval and observation times retained.',
        }
  return {
    ...retained,
    location: { ...retained.location, confirmed },
    pending: false,
    sources: {
      forecast: retained.sources.forecast && status(retained.sources.forecast),
      openaq: status(retained.sources.openaq),
      cpcb: status(retained.sources.cpcb),
    },
  }
}

/** Explicit public projection: do not persist unexpected private extensions or
 * exact selected/device coordinates from a future server response. */
export function publicOfflineEvidence(
  data: DashboardData,
): DashboardData | null {
  if (!validDashboard(data)) return null
  const location: Place = {
    name: data.location.name,
    state: data.location.state,
    country: 'India',
    latitude: Math.round(data.location.latitude * 10) / 10,
    longitude: Math.round(data.location.longitude * 10) / 10,
    confirmed: true,
  }
  const distance = (monitor: Monitor) => {
    if (
      !Number.isFinite(monitor.latitude) ||
      !Number.isFinite(monitor.longitude)
    )
      return null
    const rad = (n: number) => (n * Math.PI) / 180
    const a = rad(monitor.latitude! - location.latitude),
      b = rad(monitor.longitude! - location.longitude)
    const h =
      Math.sin(a / 2) ** 2 +
      Math.cos(rad(location.latitude)) *
        Math.cos(rad(monitor.latitude!)) *
        Math.sin(b / 2) ** 2
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
  }
  const monitor = (m: Monitor): Monitor => ({
    ...pick(m, [
      'source',
      'station',
      'city',
      'state',
      'latitude',
      'longitude',
      'pollutant',
      'value',
      'unit',
      'observedAt',
      'stale',
      'url',
      'id',
      'providerStationId',
      'sensorId',
      'canonicalStationId',
      'originId',
      'statistic',
      'owner',
      'upstreamProvider',
      'qualityStatus',
      'referenceMonitor',
      'siting',
    ]),
    period: m.period ? { start: m.period.start, end: m.period.end } : m.period,
    qualityFlags: m.qualityFlags?.filter((flag) =>
      ['string', 'number', 'boolean'].includes(typeof flag),
    ),
    qualityStatus: m.qualityFlags?.some(
      (flag) => !['string', 'number', 'boolean'].includes(typeof flag),
    )
      ? 'not_supplied'
      : m.qualityStatus,
    instruments: m.instruments && [...m.instruments],
    distanceKm: distance(m),
  })
  const status = (s: SourceStatus) =>
    pick(s, ['status', 'message', 'lastAttemptAt', 'lastSuccessAt'])
  const monitors = data.monitors.map(monitor),
    nearbyMonitors = data.nearbyMonitors?.map(monitor)
  const distances = (nearbyMonitors || monitors).map(
    (m) => m.distanceKm ?? Infinity,
  )
  const nearest = Math.min(...distances)
  const forecast = data.forecast && {
    ...pick(data.forecast, [
      'id',
      'issuedAt',
      'fetchedAt',
      'timezone',
      'source',
    ]),
    grid: {
      latitude: data.forecast.grid.latitude,
      longitude: data.forecast.grid.longitude,
    },
    points: data.forecast.points.map((p) => ({
      time: p.time,
      pm25: p.pm25,
      pm10: p.pm10,
    })),
    ...(data.forecast.pollutants
      ? {
          pollutants: Object.fromEntries(
            Object.entries(data.forecast.pollutants).map(([key, s]) => [
              key,
              s && {
                ...pick(s, [
                  'schemaVersion',
                  'unit',
                  'source',
                  'statistic',
                  'stepMinutes',
                ]),
                values: s.values.map((p) => ({ time: p.time, value: p.value })),
              },
            ]),
          ),
        }
      : {}),
  }
  return structuredClone({
    schemaVersion: 2,
    snapshotId: data.snapshotId,
    location,
    forecast,
    monitors,
    nearbyMonitors,
    sources: {
      forecast: data.sources.forecast && status(data.sources.forecast),
      openaq: status(data.sources.openaq),
      cpcb: status(data.sources.cpcb),
    },
    policy: data.policy && {
      ...pick(data.policy, ['date', 'version', 'status', 'message']),
      records: data.policy.records.map((r) =>
        pick(r, ['id', 'title', 'url', 'reviewedAt', 'instruction']),
      ),
      sources: data.policy.sources.map((s) => ({ name: s.name, url: s.url })),
    },
    comparison: data.comparison && {
      ...pick(data.comparison, ['eligible', 'sharedOrigin', 'message']),
      reasons: [...data.comparison.reasons],
    },
    coverage: data.coverage && {
      ...pick(data.coverage, [
        'state',
        'returnedStationCount',
        'searchRadiusKm',
        'catalogAt',
      ]),
      nearestDistanceKm: Number.isFinite(nearest) ? nearest : null,
      message:
        'Cached bounded station coverage; distances recomputed from the rounded area.',
    },
    ingestionPaused: data.ingestionPaused,
    ingestionWarning: data.ingestionWarning,
    pending: false,
  })
}
