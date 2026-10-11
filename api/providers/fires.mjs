import { ApiError, finite, hash, timestamp } from '../core.mjs'
export function fireBounds(area) {
  return {
    west: Math.max(68, area.longitude - 1),
    south: Math.max(6, area.latitude - 1),
    east: Math.min(98, area.longitude + 1),
    north: Math.min(38, area.latitude + 1),
  }
}
function parseCsv(raw) {
  if (typeof raw !== 'string' || raw.length > 2000000)
    throw new ApiError('Fire CSV exceeds bounds.', 502)
  const rows = []
  let row = [],
    cell = '',
    quoted = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c === '"') {
      if (quoted && raw[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (c === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && raw[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((s) => s.trim())) rows.push(row)
      row = []
      cell = ''
      if (rows.length > 10001) throw new ApiError('Too many fire rows.', 502)
    } else cell += c
  }
  if (quoted) throw new ApiError('Fire CSV quoting is invalid.', 502)
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
export function validateFires(
  raw,
  area,
  now = Date.now(),
  product = 'VIIRS_NOAA20_NRT',
) {
  if (!['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'].includes(product))
    throw new ApiError('Fire product is unsupported.', 502)
  const rows = parseCsv(raw),
    header = rows.shift()?.map((v) => v.trim()),
    bounds = fireBounds(area)
  if (
    !header ||
    ![
      'latitude',
      'longitude',
      'acq_date',
      'acq_time',
      'satellite',
      'instrument',
      'confidence',
      'frp',
    ].every((k) => header.includes(k))
  )
    throw new ApiError('Fire CSV metadata is unavailable or invalid.', 502)
  const detections = new Map()
  let discarded = 0
  for (const cells of rows) {
    const r = Object.fromEntries(header.map((k, i) => [k, cells[i]])),
      latitude = finite(r.latitude),
      longitude = finite(r.longitude),
      acqTime = String(r.acq_time || '').padStart(4, '0'),
      acquiredAt = timestamp(
        `${r.acq_date}T${acqTime.slice(0, 2)}:${acqTime.slice(2)}:00Z`,
      ),
      frp = finite(r.frp),
      satellite = product === 'VIIRS_NOAA20_NRT' ? 'N20' : 'N21'
    if (
      cells.length !== header.length ||
      latitude === null ||
      longitude === null ||
      latitude < bounds.south ||
      latitude > bounds.north ||
      longitude < bounds.west ||
      longitude > bounds.east ||
      !/^\d{4}$/.test(acqTime) ||
      !acquiredAt ||
      Date.parse(acquiredAt) > now + 300000 ||
      Date.parse(acquiredAt) < now - 48 * 3600000 ||
      r.satellite !== satellite ||
      r.instrument !== 'VIIRS' ||
      !['l', 'n', 'h'].includes(r.confidence) ||
      frp === null ||
      frp < 0
    ) {
      discarded++
      continue
    }
    const id = hash([r.satellite, acquiredAt, latitude, longitude])
    detections.set(id, {
      id,
      latitude,
      longitude,
      acquiredAt,
      satellite: r.satellite,
      instrument: 'VIIRS',
      confidence: { l: 'low', n: 'nominal', h: 'high' }[r.confidence],
      fireRadiativePower: frp,
      unit: 'MW',
      product,
    })
  }
  if (rows.length && !detections.size && discarded)
    throw new ApiError(
      'Fire rows failed validation; no absence-of-fire conclusion is available.',
      502,
    )
  const points = [...detections.values()].sort((a, b) =>
    b.acquiredAt.localeCompare(a.acquiredAt),
  )
  return {
    schemaVersion: 1,
    source: 'NASA FIRMS · NOAA VIIRS',
    attribution: 'https://firms.modaps.eosdis.nasa.gov/',
    product,
    bounds,
    fetchedAt: new Date(now).toISOString(),
    windowHours: 48,
    discardedRows: discarded,
    truncated: points.length > 500,
    detections: points.slice(0, 500),
    meaning:
      'Satellite detections, not continuous observation. No detections does not prove no fire; points do not establish stubble identity or the cause of local pollution.',
  }
}
export async function fetchFires(area, request, keys) {
  if (!keys.FIRMS_MAP_KEY)
    throw new ApiError(
      'FIRMS key is not configured.',
      503,
      'provider_not_configured',
    )
  const product = process.env.FIRMS_PRODUCT || 'VIIRS_NOAA20_NRT'
  if (!['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'].includes(product))
    throw new ApiError('FIRMS product is not supported.', 503)
  const b = fireBounds(area),
    url = new URL(
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(keys.FIRMS_MAP_KEY)}/${product}/${b.west},${b.south},${b.east},${b.north}/2`,
    )
  const raw = await request('firms', url, { responseType: 'text' })
  return { value: validateFires(raw, area, Date.now(), product), raw }
}
