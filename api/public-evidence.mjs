import { ApiError, coordinates, sourceAge, validDate } from './core.mjs'
import { capabilities } from './capabilities.mjs'
export function publicArea(params) {
  const id = params.get('area') || ''
  if (!/^\d{1,2}\.\d,\d{1,2}\.\d$/.test(id))
    throw new ApiError('Use a coarse India area such as 28.6,77.2.')
  const [latitude, longitude] = id.split(',').map(Number)
  if (!coordinates(latitude, longitude))
    throw new ApiError('Area is outside supported India coverage.')
  return { id, latitude, longitude, city: '', state: '' }
}
export function planningDate(value, now = Date.now()) {
  const today = new Date(now).toLocaleDateString('sv-SE', {
      timeZone: 'Asia/Kolkata',
    }),
    last = new Date(Date.parse(`${today}T12:00:00Z`) + 2 * 86400000)
      .toISOString()
      .slice(0, 10),
    date = value || today
  if (!validDate(date) || date < today || date > last)
    throw new ApiError('Choose today or either of the next two days.')
  return date
}
export function publicProjection(data, date, now = Date.now()) {
  if (data.sample || data.replay || data.fixtures)
    throw new ApiError(
      'Sample/replay evidence cannot be published as live data.',
      409,
    )
  const source = (entry) => ({
    status: entry?.status || 'unavailable',
    lastAttemptAt: entry?.lastAttemptAt || null,
    lastSuccessAt: entry?.lastSuccessAt || null,
  })
  return {
    schemaVersion: 1,
    date,
    generatedAt: new Date(now).toISOString(),
    area: {
      latitude: Math.round(data.location.latitude * 10) / 10,
      longitude: Math.round(data.location.longitude * 10) / 10,
    },
    pending: Boolean(data.pending),
    forecast:
      data.forecast && !data.forecast.sample && !data.forecast.replay
        ? {
            source: 'Open-Meteo · CAMS Global',
            unit: 'µg/m³',
            timezone: 'Asia/Kolkata',
            fetchedAt: data.forecast.fetchedAt,
            age: sourceAge(data.forecast.fetchedAt, now, 6 * 3600000),
            grid: {
              latitude: data.forecast.grid.latitude,
              longitude: data.forecast.grid.longitude,
            },
            points: data.forecast.points
              .filter(
                (p) =>
                  new Date(p.time).toLocaleDateString('sv-SE', {
                    timeZone: 'Asia/Kolkata',
                  }) === date,
              )
              .slice(0, 24)
              .map((p) => ({ time: p.time, pm25: p.pm25, pm10: p.pm10 })),
            attribution: 'https://open-meteo.com/en/docs/air-quality-api',
          }
        : null,
    observations: (data.nearbyMonitors || data.monitors || [])
      .filter((m) => !m.sample && !m.replay)
      .slice(0, 10)
      .map((m) => ({
        source: m.source,
        station: m.station,
        pollutant: 'PM2.5',
        value: m.value,
        unit: 'µg/m³',
        observedAt: m.observedAt,
        stale: sourceAge(m.observedAt, now) !== 'current',
        statistic: m.statistic || null,
        period: m.period ? { start: m.period.start, end: m.period.end } : null,
        qualityFlags: (m.qualityFlags || [])
          .filter((f) => typeof f === 'string')
          .slice(0, 20),
        attribution:
          m.source === 'OpenAQ'
            ? 'https://openaq.org/'
            : 'https://www.data.gov.in/',
      })),
    sources: {
      forecast: source(data.sources.forecast),
      openaq: source(data.sources.openaq),
      cpcb: source(data.sources.cpcb),
    },
    guidance:
      'Regional model and independent observations. Concentrations are not official Indian AQI, a safety guarantee or an official order.',
  }
}
export async function publicEvidence(params, engine, store) {
  if (!capabilities().publicEvidence)
    throw new ApiError(
      'Public redistribution has not been enabled and reviewed.',
      503,
    )
  if ([...params.keys()].some((k) => !['area', 'date'].includes(k)))
    throw new ApiError('Only area and date parameters are supported.')
  const area = publicArea(params),
    date = planningDate(params.get('date'))
  if (
    !(await store.increment(
      `PUBLIC_QUOTA#${Math.floor(Date.now() / 60000)}`,
      120,
      Math.floor(Date.now() / 1000) + 3600,
    ))
  )
    throw new ApiError(
      'Public evidence request budget reached. Retry later.',
      429,
    )
  return publicProjection(
    await engine.dashboard(
      {
        name: 'Public coarse area',
        state: '',
        country: 'India',
        latitude: area.latitude,
        longitude: area.longitude,
        detected: true,
      },
      date,
    ),
    date,
  )
}
const escape = (value) =>
  String(value ?? 'unavailable').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )
export function widgetResponse(data) {
  const origins = (process.env.PUBLIC_EMBED_ORIGINS || '')
    .split(',')
    .filter(Boolean)
  if (
    origins.some((o) => {
      try {
        const u = new URL(o)
        return (
          u.protocol !== 'https:' || u.origin !== o || u.username || u.password
        )
      } catch {
        return true
      }
    })
  )
    throw new ApiError('Widget embed origins are not valid.', 503)
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Airday public evidence</title><style>body{font:18px system-ui;margin:24px;background:#f5f8f7;color:#153c37}table{border-collapse:collapse;width:100%}td,th{padding:8px;text-align:left;border-bottom:1px solid #bbb}a{color:#174f67}</style><h1>Airday · ${escape(data.date)} IST</h1><p>Coarse area ${escape(data.area.latitude)}, ${escape(data.area.longitude)} · generated ${escape(data.generatedAt)}</p><p>Forecast: ${escape(data.forecast?.age || 'unavailable')} · retrieved ${escape(data.forecast?.fetchedAt)}</p><table><caption>Regional forecast · µg/m³</caption><thead><tr><th>Valid time</th><th>PM2.5</th><th>PM10</th></tr></thead><tbody>${(data.forecast?.points || []).map((p) => `<tr><td>${escape(p.time)}</td><td>${escape(p.pm25)}</td><td>${escape(p.pm10)}</td></tr>`).join('')}</tbody></table><h2>Independent observations</h2>${data.observations.map((m) => `<p>${escape(m.station)} · ${escape(m.source)} · ${escape(m.value)} µg/m³ · ${escape(m.observedAt)} · ${m.stale ? 'old/unverified' : 'recent'} · ${escape(m.statistic)} · period ${escape(m.period?.start)}–${escape(m.period?.end)} · flags ${escape(m.qualityFlags.join(', ') || 'none reported')}</p>`).join('') || '<p>No usable observations returned.</p>'}<p>${escape(data.guidance)}</p><p>This snapshot does not refresh automatically. Reload for current availability.</p><p><a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer">Open-Meteo / CAMS</a> · <a href="https://openaq.org/" target="_blank" rel="noreferrer">OpenAQ</a> · <a href="https://www.data.gov.in/" target="_blank" rel="noreferrer">data.gov.in</a></p></html>`
  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors ${origins.length ? origins.join(' ') : "'none'"}`,
    },
    body: html,
  }
}
