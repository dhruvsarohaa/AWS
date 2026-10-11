import { createHash } from 'node:crypto'

export class ApiError extends Error {
  constructor(message, status = 400, code) {
    super(message)
    this.status = status
    this.code = code
  }
}
export const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)
export const finite = (value) =>
  (typeof value === 'number' ||
    (typeof value === 'string' &&
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))) &&
  Number.isFinite(Number(value))
    ? Number(value)
    : null
export const concentration = (value) => {
  const number = finite(value)
  return number !== null && number >= 0 ? number : null
}
export function validDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().startsWith(value)
  )
}
export function timestamp(value) {
  return typeof value === 'string' &&
    validDate(value.slice(0, 10)) &&
    /T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null
}
export function unit(value) {
  const text = String(value || '')
    .replace(/[μµ]/g, 'u')
    .replace(/³/g, '3')
    .replace(/\s/g, '')
    .toLowerCase()
  return ['ug/m3', 'ug/m^3'].includes(text) ? 'µg/m³' : null
}
export function distanceKm(aLat, aLon, bLat, bLon) {
  const rad = (n) => (n * Math.PI) / 180
  const term =
    Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) *
      Math.cos(rad(bLat)) *
      Math.sin(rad(bLon - aLon) / 2) ** 2
  return (
    6371 *
    2 *
    Math.atan2(Math.sqrt(Math.min(1, term)), Math.sqrt(Math.max(0, 1 - term)))
  )
}
export function coordinates(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= 6 &&
    lat <= 38 &&
    lon >= 68 &&
    lon <= 98
  )
}
export function sourceAge(at, now = Date.now(), maxAge = 3 * 3600000) {
  const date = at ? Date.parse(at) : NaN
  return !Number.isFinite(date) || date > now + 300000
    ? 'unverified'
    : now - date > maxAge
      ? 'stale'
      : 'current'
}
export const publicError = (error) =>
  error instanceof ApiError
    ? error.message
    : 'The service could not complete this request. Please retry.'
export function placeFromParams(params) {
  const lat =
    params.has('lat') && params.get('lat') !== ''
      ? Number(params.get('lat'))
      : NaN
  const lon =
    params.has('lon') && params.get('lon') !== ''
      ? Number(params.get('lon'))
      : NaN
  const city = params.get('city') || 'Selected Indian area',
    state = params.get('state') || ''
  if (!coordinates(lat, lon) || city.length > 80 || state.length > 80)
    throw new ApiError('Choose a supported Indian location.')
  return {
    name: city,
    state,
    country: 'India',
    latitude: lat,
    longitude: lon,
    detected: params.get('mode') === 'coordinates',
  }
}
export function areaFor(place) {
  // Refresh demand retains a coarse area, never exact device coordinates.
  const latitude = Math.round(place.latitude * 10) / 10,
    longitude = Math.round(place.longitude * 10) / 10
  return {
    id: `${latitude.toFixed(1)},${longitude.toFixed(1)}`,
    latitude,
    longitude,
    city: place.detected ? '' : place.name,
    state: place.detected ? '' : place.state,
  }
}
export function validateForecast(payload, now = Date.now()) {
  if (
    !['Asia/Kolkata', 'Asia/Calcutta'].includes(payload?.timezone) ||
    payload.utc_offset_seconds !== 19800
  )
    throw new ApiError('Forecast timezone metadata could not be verified.', 502)
  const hourly = payload?.hourly
  if (
    !Array.isArray(hourly?.time) ||
    hourly.time.length > 240 ||
    !unit(payload.hourly_units?.pm2_5) ||
    !unit(payload.hourly_units?.pm10)
  )
    throw new ApiError(
      'Forecast units or time series could not be verified.',
      502,
    )
  if (!coordinates(finite(payload.latitude), finite(payload.longitude)))
    throw new ApiError('Forecast grid coordinates are invalid.', 502)
  let previousTime = -Infinity
  const points = hourly.time.map((raw, index) => {
    const time = timestamp(
      /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}+05:30`,
    )
    if (!time) throw new ApiError('Forecast timestamp is invalid.', 502)
    if (Date.parse(time) <= previousTime)
      throw new ApiError('Forecast hours are duplicated or out of order.', 502)
    previousTime = Date.parse(time)
    return {
      time:
        new Date(time)
          .toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' })
          .replace(' ', 'T') + '+05:30',
      pm25: concentration(hourly.pm2_5?.[index]),
      pm10: concentration(hourly.pm10?.[index]),
    }
  })
  if (!points.some((point) => point.pm25 !== null || point.pm10 !== null))
    throw new ApiError('Forecast contains no usable pollutant values.', 502)
  const content = {
    points,
    pollutants: Object.fromEntries(
      [
        ['pm25', 'pm2_5'],
        ['pm10', 'pm10'],
        ['no2', 'nitrogen_dioxide'],
        ['o3', 'ozone'],
        ['so2', 'sulphur_dioxide'],
        ['co', 'carbon_monoxide'],
      ]
        .filter(
          ([, field]) =>
            unit(payload.hourly_units?.[field]) &&
            Array.isArray(hourly[field]) &&
            hourly[field].length === points.length,
        )
        .map(([key, field]) => [
          key,
          {
            schemaVersion: 1,
            unit: 'µg/m³',
            source: 'Open-Meteo · CAMS Global',
            statistic: 'model_sample',
            stepMinutes: 60,
            values: points.map((p, i) => ({
              time: p.time,
              value: concentration(hourly[field][i]),
            })),
          },
        ]),
    ),
    grid: {
      latitude: Number(payload.latitude),
      longitude: Number(payload.longitude),
    },
    source: 'Open-Meteo · CAMS Global',
    model: 'cams_global',
    unit: 'µg/m³',
  }
  return {
    ...content,
    id: hash(content),
    schemaVersion: 2,
    fetchedAt: new Date(now).toISOString(),
    issuedAt: null,
    timezone: 'Asia/Kolkata',
    spatialResolutionKm: 45,
    sourceStepHours: 3,
  }
}
export function comparable(a, b) {
  const reasons = []
  if (!a.canonicalStationId || a.canonicalStationId !== b.canonicalStationId)
    reasons.push('Station identity has not been verified as the same.')
  if (a.pollutant !== b.pollutant || !unit(a.unit) || !unit(b.unit))
    reasons.push('Pollutant or units differ or are unknown.')
  if (
    !a.period?.start ||
    !a.period?.end ||
    a.period.start !== b.period?.start ||
    a.period.end !== b.period?.end ||
    a.statistic !== b.statistic ||
    a.statistic !== 'mean'
  )
    reasons.push('Measurement periods or statistics differ or are unknown.')
  const sharedOrigin = Boolean(a.originId && a.originId === b.originId)
  return {
    eligible: !reasons.length,
    sharedOrigin,
    reasons,
    message: reasons.length
      ? reasons.join(' ')
      : sharedOrigin
        ? 'These feeds share an observation origin; they are not independent evidence.'
        : 'Same verified station, pollutant, units, statistic and period. Processing may still differ.',
  }
}
