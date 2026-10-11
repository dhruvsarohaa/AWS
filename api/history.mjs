import { ApiError, areaFor, hash, validDate, distanceKm } from './core.mjs'
import { nearbyStations } from './spatial.mjs'
const ttl = () => Math.floor(Date.now() / 1000) + 90 * 86400
/** Prospective run catalog; first retrieval retained, not inferred model issuance. Shared grids still index each admitted area. */
export async function retainRun(store, area, forecast) {
  const now = Date.now() / 1000
  let retained = await store.get(`FORECAST#${forecast.id}`)
  if (!retained || retained.expireAt <= now) {
    await store.replace(
      `FORECAST#${forecast.id}`,
      'current',
      forecast,
      retained?.version || 0,
      {
        expireAt: ttl(),
      },
    )
    // An identical run may be retained concurrently for a shared model grid.
    // Read back the winner before publishing a catalog pointer.
    retained = await store.get(`FORECAST#${forecast.id}`)
    if (!retained || retained.expireAt <= now)
      throw new ApiError(
        'The forecast run could not be retained. Retry the refresh.',
        503,
      )
  }
  const existing = await store.get(`RUN#${area.id}`, forecast.id)
  const run = {
    id: forecast.id,
    retrievedAt:
      existing?.expireAt > now ? existing.data.retrievedAt : forecast.fetchedAt,
    issuedAt: forecast.issuedAt || null,
    source: forecast.source,
    grid: forecast.grid,
    firstValidAt: forecast.points[0]?.time || null,
    lastValidAt: forecast.points.at(-1)?.time || null,
  }
  await store.put(`RUN#${area.id}`, forecast.id, run, {
    expireAt: retained.expireAt,
  })
  await store.put(`RUNS#${area.id}`, `${run.retrievedAt}#${run.id}`, run, {
    expireAt: retained.expireAt,
  })
}
function cursor(params, scope, begin, end) {
  const raw = params.get('cursor')
  if (!raw) return null
  if (raw.length > 800) throw new ApiError('History cursor is too long.')
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (
      c.scope !== scope ||
      typeof c.after !== 'string' ||
      c.after.length > 200 ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z#[a-f0-9]{32}$/.test(
        c.after,
      ) ||
      !validDate(c.after.slice(0, 10)) ||
      c.after < begin ||
      c.after > `${end}~`
    )
      throw new Error()
    return c.after
  } catch {
    throw new ApiError('History cursor does not match this range and source.')
  }
}
const next = (scope, after) =>
  after
    ? Buffer.from(JSON.stringify({ scope, after })).toString('base64url')
    : null
export async function historyRoute(params, place, store) {
  const area = areaFor(place),
    kind = params.get('kind') || 'runs',
    from = params.get('from'),
    to = params.get('to')
  if (
    !validDate(from) ||
    !validDate(to) ||
    to < from ||
    Date.parse(to) - Date.parse(from) > 30 * 86400000
  )
    throw new ApiError('Choose a valid range of at most 31 dates.')
  const today = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Kolkata',
  })
  if (
    to > new Date(Date.parse(today) + 7 * 86400000).toISOString().slice(0, 10)
  )
    throw new ApiError('History range is outside retained forecast bounds.')
  const begin = new Date(`${from}T00:00:00+05:30`).toISOString(),
    end = new Date(`${to}T23:59:59.999+05:30`).toISOString()
  const scope = hash({
    area: area.id,
    kind,
    from,
    to,
    sensor: params.get('sensor'),
    run: params.get('run'),
  })
  const base = {
    schemaVersion: 1,
    areaId: area.id,
    kind,
    from,
    to,
    retentionDays: 90,
    sourceMeaning:
      'Retained evidence only. Gaps are not filled; source changes remain separate.',
    retrievedAt: new Date().toISOString(),
  }
  if (kind === 'runs') {
    const page = await store.range(
      `RUNS#${area.id}`,
      begin,
      `${end}~`,
      50,
      cursor(params, scope, begin, end),
    )
    return {
      ...base,
      runs: page.rows.map((r) => r.data),
      status: (await store.get(`RUN_STATUS#${area.id}`))?.data || null,
      nextCursor: next(scope, page.after),
    }
  }
  if (kind === 'forecast') {
    const id = params.get('run')
    if (!/^[a-f0-9]{32}$/.test(id || ''))
      throw new ApiError('Select a retained forecast run.')
    const pointer = await store.get(`RUN#${area.id}`, id)
    if (!pointer || pointer.expireAt <= Date.now() / 1000)
      throw new ApiError('This area has no retained run with that ID.', 404)
    const row = await store.get(`FORECAST#${id}`)
    if (!row || row.expireAt <= Date.now() / 1000)
      throw new ApiError('This retained run has expired.', 404)
    const f = row.data,
      points = f.points.filter(
        (p) => p.time.slice(0, 10) >= from && p.time.slice(0, 10) <= to,
      )
    return {
      ...base,
      run: pointer.data,
      forecast: {
        ...f,
        points,
        pollutants: Object.fromEntries(
          Object.entries(f.pollutants || {}).map(([k, s]) => [
            k,
            {
              ...s,
              values: s.values.filter(
                (p) => p.time.slice(0, 10) >= from && p.time.slice(0, 10) <= to,
              ),
            },
          ]),
        ),
      },
      nextCursor: null,
    }
  }
  if (kind === 'observations') {
    const sensor = params.get('sensor')
    if (!/^\d{1,15}$/.test(sensor || ''))
      throw new ApiError('Select a returned station sensor.')
    const source = await store.get(`SOURCE#${area.id}`, 'openaq')
    const candidates = [
      ...(!source?.expireAt || source.expireAt > Date.now() / 1000
        ? source?.data?.value?.monitors || []
        : []),
      ...(await nearbyStations(store, place)),
    ]
    const station = candidates.find(
      (m) =>
        m.source === 'OpenAQ' &&
        String(m.sensorId) === sensor &&
        Number.isFinite(m.latitude) &&
        Number.isFinite(m.longitude) &&
        distanceKm(place.latitude, place.longitude, m.latitude, m.longitude) <=
          25,
    )
    if (!station)
      throw new ApiError(
        'Sensor is not in this area’s bounded returned catalog.',
        404,
      )
    const page = await store.range(
        `HISTORY#${sensor}`,
        begin,
        `${end}~`,
        500,
        cursor(params, scope, begin, end),
      ),
      status = (await store.get(`HISTORY_STATUS#${area.id}`))?.data || null
    return {
      ...base,
      station: {
        station: station.station,
        sensorId: sensor,
        source: station.source,
        unit: station.unit,
        url: station.url,
      },
      observations: page.rows.map((r) => r.data),
      status,
      nextCursor: next(scope, page.after),
    }
  }
  throw new ApiError('History kind must be runs, forecast or observations.')
}
