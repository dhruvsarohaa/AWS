import { ApiError, coordinates, finite, hash, timestamp } from '../core.mjs'
export const WEATHER_FIELDS = {
  temperature_2m: ['temperature', '°C', -90, 60, 'instant'],
  apparent_temperature: ['apparentTemperature', '°C', -120, 80, 'instant'],
  relative_humidity_2m: ['humidity', '%', 0, 100, 'instant'],
  precipitation: ['precipitation', 'mm', 0, 1000, 'preceding_hour_total'],
  wind_speed_10m: ['windSpeed', 'm/s', 0, 150, 'instant'],
  wind_direction_10m: ['windDirection', '°', 0, 360, 'instant'],
}
export function validateWeather(raw, now = Date.now()) {
  const hourly = raw?.hourly
  if (
    !['GMT', 'UTC'].includes(raw?.timezone) ||
    raw.utc_offset_seconds !== 0 ||
    !coordinates(finite(raw.latitude), finite(raw.longitude)) ||
    !Array.isArray(hourly?.time) ||
    !hourly.time.length ||
    hourly.time.length > 96
  )
    throw new ApiError('Weather timezone, grid or time series is invalid.', 502)
  for (const [field, [, unit]] of Object.entries(WEATHER_FIELDS))
    if (
      raw.hourly_units?.[field] !== unit ||
      !Array.isArray(hourly[field]) ||
      hourly[field].length !== hourly.time.length
    )
      throw new ApiError(
        'Weather field units or array lengths are invalid.',
        502,
      )
  let previous = -Infinity
  const first = Date.parse(
    `${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`,
  )
  const points = hourly.time.map((t, i) => {
    const time = timestamp(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(t) ? t : `${t}Z`)
    if (
      !time ||
      Date.parse(time) <= previous ||
      Date.parse(time) < first ||
      Date.parse(time) >= first + 3 * 86400000 ||
      Date.parse(time) % 3600000 !== 0
    )
      throw new ApiError(
        'Weather times are invalid, unordered or outside the three-day UTC horizon.',
        502,
      )
    previous = Date.parse(time)
    return {
      time,
      ...Object.fromEntries(
        Object.entries(WEATHER_FIELDS).map(([field, [key, , min, max]]) => {
          const rawValue = hourly[field][i],
            value = rawValue === null ? null : finite(rawValue)
          if (
            rawValue !== null &&
            (value === null || value < min || value > max)
          )
            throw new ApiError(
              'Weather value is outside supported bounds.',
              502,
            )
          return [key, value]
        }),
      ),
    }
  })
  if (
    !points.some((p) =>
      Object.keys(p).some((k) => k !== 'time' && p[k] !== null),
    )
  )
    throw new ApiError('Weather has no usable values.', 502)
  return {
    schemaVersion: 1,
    id: hash(points),
    source: 'Open-Meteo Weather · best match',
    attribution: 'https://open-meteo.com/en/docs',
    fetchedAt: new Date(now).toISOString(),
    grid: { latitude: finite(raw.latitude), longitude: finite(raw.longitude) },
    timezone: 'UTC',
    fields: Object.fromEntries(
      Object.values(WEATHER_FIELDS).map(([key, unit, , , statistic]) => [
        key,
        { unit, statistic },
      ]),
    ),
    points,
  }
}
export async function fetchWeather(area, request, keys) {
  const url = new URL(
    keys.OPEN_METEO_API_KEY
      ? 'https://customer-api.open-meteo.com/v1/forecast'
      : 'https://api.open-meteo.com/v1/forecast',
  )
  for (const [name, value] of Object.entries({
    latitude: area.latitude,
    longitude: area.longitude,
    hourly: Object.keys(WEATHER_FIELDS).join(','),
    timezone: 'UTC',
    forecast_days: 3,
    temperature_unit: 'celsius',
    wind_speed_unit: 'ms',
    precipitation_unit: 'mm',
  }))
    url.searchParams.set(name, String(value))
  if (keys.OPEN_METEO_API_KEY)
    url.searchParams.set('apikey', keys.OPEN_METEO_API_KEY)
  const raw = await request('weather', url)
  return { value: validateWeather(raw), raw }
}
