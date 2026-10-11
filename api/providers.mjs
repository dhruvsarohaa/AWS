import { readFile } from 'node:fs/promises'
import {
  ApiError,
  concentration,
  coordinates,
  distanceKm,
  finite,
  hash,
  sourceAge,
  timestamp,
  unit,
  validateForecast,
} from './core.mjs'
import { admitStation, stationCapacity } from './spatial.mjs'

const contract = JSON.parse(
  await readFile(
    new URL('./config/cpcb-contract.json', import.meta.url),
    'utf8',
  ),
)
const pm25 = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') === 'pm25'
export const OPENAQ_SELECTION_VERSION = 2

// Location datetimeLast can describe any pollutant. It only prioritizes a
// bounded latest lookup; the displayed PM2.5 time still comes from that sensor.
export function selectOpenAqLocations(area, results, now = Date.now()) {
  const seen = new Set()
  const selected = []
  for (const location of results) {
    const latitude = finite(location?.coordinates?.latitude)
    const longitude = finite(location?.coordinates?.longitude)
    const sensors = Array.isArray(location?.sensors)
      ? location.sensors.filter(
          (sensor) =>
            Number.isSafeInteger(sensor?.id) &&
            sensor.id > 0 &&
            pm25(sensor.parameter?.name) &&
            unit(sensor.parameter?.units),
        )
      : []
    // OpenAQ has no documented outdoor-siting field. Explicit indoor labels
    // are excluded conservatively; absence of a label does not verify siting.
    const explicitIndoor = [
      location?.name,
      location?.locality,
      location?.owner?.name,
    ].some((value) => typeof value === 'string' && /\bindoors?\b/i.test(value))
    if (
      !Number.isSafeInteger(location?.id) ||
      location.id <= 0 ||
      seen.has(location.id) ||
      location.country?.code !== 'IN' ||
      location.isMobile !== false ||
      !coordinates(latitude, longitude) ||
      distanceKm(area.latitude, area.longitude, latitude, longitude) > 25 ||
      !sensors.length ||
      explicitIndoor
    )
      continue
    seen.add(location.id)
    selected.push({
      ...location,
      coordinates: { latitude, longitude },
      sensors,
    })
  }
  const recency = (location) => {
    const at = timestamp(location.datetimeLast?.utc)
    const age = sourceAge(at, now)
    return age === 'current' ? 0 : age === 'stale' ? 1 : 2
  }
  const referenceRank = (location) =>
    location.isMonitor === true ? 0 : location.isMonitor === false ? 1 : 2
  return selected
    .sort(
      (a, b) =>
        recency(a) - recency(b) ||
        (recency(a) === 1
          ? Date.parse(timestamp(b.datetimeLast?.utc)) -
            Date.parse(timestamp(a.datetimeLast?.utc))
          : 0) ||
        referenceRank(a) - referenceRank(b) ||
        distanceKm(
          area.latitude,
          area.longitude,
          a.coordinates.latitude,
          a.coordinates.longitude,
        ) -
          distanceKm(
            area.latitude,
            area.longitude,
            b.coordinates.latitude,
            b.coordinates.longitude,
          ) ||
        a.id - b.id,
    )
    .slice(0, 5)
}
export function normalizeOpenAq(location, sensor, reading, now = Date.now()) {
  const value = concentration(reading?.value),
    measuredUnit = unit(sensor.parameter?.units)
  const observedAt = timestamp(
    reading?.period?.datetimeTo?.utc || reading?.datetime?.utc,
  )
  const latitude = finite(location.coordinates?.latitude),
    longitude = finite(location.coordinates?.longitude)
  if (
    value === null ||
    !measuredUnit ||
    !coordinates(latitude, longitude) ||
    !pm25(sensor.parameter?.name)
  )
    return null
  const start = timestamp(reading.period?.datetimeFrom?.utc),
    end = timestamp(reading.period?.datetimeTo?.utc)
  const period =
    start && end && Date.parse(end) > Date.parse(start) ? { start, end } : null
  const base = {
    source: 'OpenAQ',
    providerStationId: String(location.id),
    sensorId: String(sensor.id),
    canonicalStationId: `openaq:${location.id}`,
    originId: `openaq:${location.id}:${sensor.id}`,
    station: String(location.name || 'Unnamed OpenAQ station'),
    city: String(location.locality || ''),
    latitude,
    longitude,
    pollutant: 'PM2.5',
    value,
    unit: measuredUnit,
    observedAt,
    fetchedAt: new Date(now).toISOString(),
    statistic: period ? 'mean' : 'unknown',
    period,
    siteType: location.isMobile ? 'mobile' : 'stationary',
    referenceMonitor:
      typeof location.isMonitor === 'boolean' ? location.isMonitor : null,
    instruments: (Array.isArray(location.instruments)
      ? location.instruments
      : []
    )
      .slice(0, 5)
      .map((instrument) => String(instrument.name || '').slice(0, 120))
      .filter(Boolean),
    siting: 'not_verified',
    owner: location.owner?.name || null,
    upstreamProvider: location.provider?.name || null,
    licenses: location.licenses || [],
    qualityFlags: [],
    qualityStatus: 'not_supplied',
    url: `https://explore.openaq.org/locations/${location.id}`,
  }
  return {
    ...base,
    id: hash({ sensor: base.originId, observedAt, period, value }),
    stale: sourceAge(observedAt, now) !== 'current',
  }
}
export function normalizeCpcb(row, metadata = contract, now = Date.now()) {
  if (
    !metadata.verified ||
    metadata.quantity !== 'concentration' ||
    !unit(metadata.unit) ||
    !metadata.sourceDocument ||
    !timestamp(metadata.reviewedAt) ||
    !metadata.reviewedBy ||
    metadata.statistic !== 'mean' ||
    !(metadata.periodSeconds > 0)
  )
    return null
  const value = concentration(row.pollutant_avg),
    latitude = finite(row.latitude),
    longitude = finite(row.longitude)
  if (
    value === null ||
    !coordinates(latitude, longitude) ||
    !pm25(row.pollutant_id)
  )
    return null
  if (row.pollutant_unit && unit(row.pollutant_unit) !== unit(metadata.unit))
    return null
  const rawTime = row[metadata.timestampField],
    dmy =
      typeof rawTime === 'string' &&
      rawTime.match(
        /^(\d{2})[-/](\d{2})[-/](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/,
      )
  const interpreted = dmy
    ? timestamp(
        `${dmy[3]}-${dmy[2]}-${dmy[1]}T${dmy[4]}:${dmy[5]}:${dmy[6] || '00'}+05:30`,
      )
    : timestamp(rawTime)
  const observedAt =
    metadata.timestampMeaning === 'measurement_end' ? interpreted : null
  const period =
    observedAt && metadata.periodSeconds > 0
      ? {
          start: new Date(
            Date.parse(observedAt) - metadata.periodSeconds * 1000,
          ).toISOString(),
          end: observedAt,
        }
      : null
  const base = {
    source: 'CPCB / data.gov.in',
    providerStationId: String(row.station),
    sensorId: null,
    canonicalStationId: null,
    originId: null,
    station: String(row.station),
    city: String(row.city || ''),
    state: String(row.state || ''),
    latitude,
    longitude,
    pollutant: 'PM2.5',
    value,
    unit: unit(metadata.unit),
    observedAt,
    providerUpdatedAt: interpreted,
    fetchedAt: new Date(now).toISOString(),
    statistic: metadata.statistic,
    period,
    owner: 'CPCB / reporting agency',
    upstreamProvider: 'data.gov.in',
    qualityFlags: [],
    qualityStatus: 'not_supplied',
    metadataDocument: metadata.sourceDocument,
    url: 'https://www.data.gov.in/resource/real-time-air-quality-index-various-locations',
  }
  return {
    ...base,
    id: hash({
      station: row.station,
      observedAt,
      updatedAt: interpreted,
      value,
    }),
    stale: sourceAge(observedAt, now) !== 'current',
  }
}
export async function fetchForecast(area, request, keys) {
  const url = new URL(
    keys.OPEN_METEO_API_KEY
      ? 'https://customer-air-quality-api.open-meteo.com/v1/air-quality'
      : 'https://air-quality-api.open-meteo.com/v1/air-quality',
  )
  for (const [key, value] of Object.entries({
    latitude: area.latitude,
    longitude: area.longitude,
    hourly: 'pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide,carbon_monoxide',
    forecast_days: 3,
    timezone: 'Asia/Kolkata',
    domains: 'cams_global',
  }))
    url.searchParams.set(key, value)
  if (keys.OPEN_METEO_API_KEY)
    url.searchParams.set('apikey', keys.OPEN_METEO_API_KEY)
  const raw = await request('openmeteo', url)
  return { forecast: validateForecast(raw), raw, status: { status: 'live' } }
}
export async function fetchOpenAq(area, request, store, keys) {
  if (!keys.OPENAQ_API_KEY)
    return {
      monitors: [],
      status: {
        status: 'not_configured',
        message: 'OpenAQ is not connected on this deployment.',
      },
    }
  const options = { headers: { 'X-API-Key': keys.OPENAQ_API_KEY } }
  let registry = (await store.get(`REGISTRY#${area.id}`))?.data
  if (
    !registry ||
    registry.selectionVersion !== OPENAQ_SELECTION_VERSION ||
    !Number.isFinite(registry.fetchedAt) ||
    registry.fetchedAt > Date.now() + 300000 ||
    Date.now() - registry.fetchedAt > 6 * 3600000
  ) {
    const url = new URL('https://api.openaq.org/v3/locations')
    for (const [key, value] of Object.entries({
      coordinates: `${area.latitude},${area.longitude}`,
      radius: 25000,
      parameters_id: 2,
      iso: 'IN',
      mobile: 'false',
      limit: 1000,
    }))
      url.searchParams.set(key, value)
    const payload = await request('openaq', url, options)
    if (!Array.isArray(payload.results) || payload.results.length > 1000)
      throw new ApiError('OpenAQ station metadata could not be verified.', 502)
    registry = {
      locations: selectOpenAqLocations(area, payload.results),
      fetchedAt: Date.now(),
      selectionVersion: OPENAQ_SELECTION_VERSION,
      returnedCatalogCount: payload.results.length,
      truncated: payload.meta?.found > payload.results.length,
    }
    await store.put(`REGISTRY#${area.id}`, 'current', registry)
  }
  const monitors = [],
    failures = []
  for (const location of registry.locations) {
    let ownsLatestLock = false
    try {
      if (!(await admitStation(store, String(location.id)))) {
        const active = (await store.list('STATIONS', 100)).filter(
          (row) => row.expireAt > Date.now() / 1000,
        ).length
        failures.push(
          active >= stationCapacity()
            ? 'Station capacity reached'
            : 'Station admission in progress',
        )
        continue
      }
      const cached = await store.get(`LATEST#${location.id}`)
      if (cached?.refreshAt > Date.now()) {
        monitors.push(...cached.data)
        continue
      }
      if (!(await store.claim(`LATEST#${location.id}`, 60))) {
        if (cached) monitors.push(...cached.data)
        else failures.push('Station refresh in progress')
        continue
      }
      ownsLatestLock = true
      const stationMonitors = []
      const payload = await request(
        'openaq',
        new URL(`https://api.openaq.org/v3/locations/${location.id}/latest`),
        options,
      )
      if (!Array.isArray(payload.results))
        throw new ApiError('OpenAQ latest readings are malformed.', 502)
      for (const sensor of location.sensors.filter((row) =>
        pm25(row.parameter?.name),
      )) {
        const reading = payload.results
          .filter((row) => row.sensorsId === sensor.id)
          .sort(
            (a, b) =>
              Date.parse(b.datetime?.utc || '') -
              Date.parse(a.datetime?.utc || ''),
          )[0]
        const normalized = normalizeOpenAq(location, sensor, reading)
        if (normalized) stationMonitors.push(normalized)
      }
      let flags = (await store.get(`FLAGS#${location.id}`))?.data
      if (!flags || Date.now() - flags.fetchedAt > 3600000) {
        try {
          const url = new URL(
            `https://api.openaq.org/v3/locations/${location.id}/flags`,
          )
          url.searchParams.set(
            'datetime_from',
            new Date(Date.now() - 86400000).toISOString(),
          )
          url.searchParams.set('limit', '100')
          const data = await request('openaq', url, options)
          flags = {
            records: Array.isArray(data.results) ? data.results : [],
            fetchedAt: Date.now(),
            verified: Array.isArray(data.results),
            truncated: Number(data.meta?.found) > data.results?.length,
          }
          await store.put(`FLAGS#${location.id}`, 'current', flags)
        } catch {
          flags = { records: [], verified: false, fetchedAt: Date.now() }
        }
      }
      for (const monitor of stationMonitors) {
        monitor.qualityFlags = flags.records
          .filter(
            (flag) =>
              (!flag.sensorIds?.length ||
                flag.sensorIds.includes(Number(monitor.sensorId))) &&
              monitor.observedAt &&
              Date.parse(flag.datetimeFrom?.utc) <=
                Date.parse(monitor.observedAt) &&
              Date.parse(flag.datetimeTo?.utc) >=
                Date.parse(monitor.observedAt),
          )
          .map((flag) => ({
            label: String(flag.flagType?.label || 'Provider flag'),
            level: String(flag.flagType?.level || 'unknown'),
            note: String(flag.note || '').slice(0, 500),
          }))
        monitor.qualityStatus = flags.verified
          ? flags.truncated
            ? 'partial'
            : 'checked'
          : 'unavailable'
      }
      await store.put(`LATEST#${location.id}`, 'current', stationMonitors, {
        refreshAt: Date.now() + 900000,
        expireAt: Math.floor(Date.now() / 1000) + 7 * 86400,
      })
      monitors.push(...stationMonitors)
    } catch (error) {
      failures.push(error.message)
      const previous = await store.get(`LATEST#${location.id}`)
      if (previous) monitors.push(...previous.data)
    } finally {
      if (ownsLatestLock) await store.delete(`LATEST#${location.id}`, 'lock')
    }
  }
  return {
    monitors,
    status: {
      status: failures.length
        ? 'unavailable'
        : monitors.length
          ? 'live'
          : 'no_data',
      message: failures.length
        ? `${failures.length} station request${failures.length === 1 ? '' : 's'} failed. ${failures.includes('Station capacity reached') ? 'The bounded active-station capacity is full; this does not mean the city has no monitors. ' : ''}${monitors.length ? 'Previously retrieved or partial readings remain visible.' : 'No usable readings are available.'}`
        : registry.truncated
          ? 'The provider returned a limited station list; coverage is partial.'
          : monitors.length
            ? 'Up to five stationary candidates are checked, prioritizing recent catalog reporting and provider reference-monitor metadata. Sensor timestamps determine freshness; siting and averaging periods may be unverified.'
            : 'No usable stationary PM2.5 measurement with verified units was returned.',
    },
  }
}
export async function reconcileOpenAq(area, request, store, keys) {
  if (
    !keys.OPENAQ_API_KEY ||
    !(await store.claim(`HISTORY#${area.id}`, 6 * 3600))
  )
    return { records: [], partial: false, skipped: true }
  const registry = (await store.get(`REGISTRY#${area.id}`))?.data
  if (!registry) {
    await store.delete(`HISTORY#${area.id}`, 'lock')
    return { records: [], partial: false, skipped: true }
  }
  const records = []
  let partial = false
  try {
    for (const location of registry.locations) {
      if (
        !(
          (await store.get('STATIONS', String(location.id)))?.expireAt >
          Date.now() / 1000
        ) ||
        !(await store.claim(`RECONCILE#${location.id}`, 6 * 3600))
      )
        continue
      try {
        for (const sensor of location.sensors
          .filter((row) => pm25(row.parameter?.name))
          .slice(0, 2)) {
          if (records.length >= 500) {
            partial = true
            break
          }
          let cursor = (await store.get(`RECONCILE_CURSOR#${sensor.id}`))?.data
          if (cursor?.after > Date.now()) continue
          cursor = cursor?.from
            ? cursor
            : {
                from: new Date(Date.now() - 48 * 3600000).toISOString(),
                to: new Date().toISOString(),
                page: 1,
              }
          const url = new URL(
            `https://api.openaq.org/v3/sensors/${sensor.id}/hours`,
          )
          url.searchParams.set('datetime_from', cursor.from)
          url.searchParams.set('datetime_to', cursor.to)
          url.searchParams.set('limit', '100')
          let complete = false
          for (let attempt = 0; attempt < 2; attempt++) {
            // Keep the provider's page size stable across resumes. Starting a
            // 100-row page without 100 remaining slots could exceed the budget
            // or drop its tail when the next cursor advances.
            if (500 - records.length < 100) break
            url.searchParams.set('page', String(cursor.page))
            const payload = await request('openaq', url, {
              headers: { 'X-API-Key': keys.OPENAQ_API_KEY },
            })
            if (!Array.isArray(payload.results) || payload.results.length > 100)
              throw new ApiError('OpenAQ history is malformed.', 502)
            for (const reading of payload.results) {
              const normalized = normalizeOpenAq(location, sensor, reading)
              if (normalized?.period) {
                const key = `${normalized.observedAt}#${normalized.id}`,
                  previous = await store.get(`HISTORY#${sensor.id}`, key)
                const record = {
                  ...normalized,
                  firstFetchedAt:
                    previous?.data.firstFetchedAt ||
                    previous?.data.fetchedAt ||
                    normalized.fetchedAt,
                  lastSeenAt: normalized.fetchedAt,
                }
                records.push(record)
                await store.put(`HISTORY#${sensor.id}`, key, record, {
                  expireAt: Math.floor(Date.now() / 1000) + 90 * 86400,
                })
              }
            }
            if (
              payload.results.length < 100 ||
              Number(payload.meta?.found) <= cursor.page * 100
            ) {
              complete = true
              await store.put(`RECONCILE_CURSOR#${sensor.id}`, 'current', {
                after: Date.now() + 6 * 3600000,
                checkedAt: new Date().toISOString(),
              })
              break
            }
            cursor.page++
            await store.put(`RECONCILE_CURSOR#${sensor.id}`, 'current', cursor)
          }
          if (!complete) partial = true
        }
        if (partial) await store.delete(`RECONCILE#${location.id}`, 'lock')
      } catch (error) {
        await store.delete(`RECONCILE#${location.id}`, 'lock')
        throw error
      }
    }
    if (partial) await store.delete(`HISTORY#${area.id}`, 'lock')
    return { records, partial, skipped: false }
  } catch (error) {
    // A failed provider call is retryable. A six-hour area lease must not turn
    // that failure into a successful skipped reconciliation on the retry.
    await store.delete(`HISTORY#${area.id}`, 'lock')
    throw error
  }
}
export async function fetchCpcb(area, request, keys) {
  if (!keys.DATAGOV_API_KEY)
    return {
      monitors: [],
      status: {
        status: 'not_configured',
        message: 'CPCB / data.gov.in is not connected on this deployment.',
      },
    }
  if (!contract.verified)
    return {
      monitors: [],
      status: {
        status: 'unverified',
        message:
          'Provider connected; measurement units and averaging-period metadata require review before numerical display.',
      },
    }
  const monitors = []
  let truncated = false
  for (let page = 0; page < 5; page++) {
    const url = new URL(
      'https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69',
    )
    for (const [key, value] of Object.entries({
      'api-key': keys.DATAGOV_API_KEY,
      format: 'json',
      limit: 1000,
      offset: page * 1000,
    }))
      url.searchParams.set(key, value)
    if (area.state) url.searchParams.set('filters[state]', area.state)
    const payload = await request('cpcb', url)
    if (!Array.isArray(payload.records))
      throw new ApiError('CPCB station data is malformed.', 502)
    for (const row of payload.records) {
      const normalized = normalizeCpcb(row)
      if (
        normalized &&
        distanceKm(
          area.latitude,
          area.longitude,
          normalized.latitude,
          normalized.longitude,
        ) <= 33
      )
        monitors.push(normalized)
    }
    if (payload.records.length < 1000) break
    if (page === 4) truncated = true
  }
  return {
    monitors,
    status: {
      status: monitors.length ? 'live' : 'no_data',
      message: truncated
        ? 'The paginated station scan reached its configured bound; coverage may be partial.'
        : monitors.length
          ? 'Measurement metadata follows the reviewed provider contract.'
          : 'No verified PM2.5 station was returned for this area.',
    },
  }
}
