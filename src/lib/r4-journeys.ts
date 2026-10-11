export const JOURNEY_LIMITS = {
  bytes: 1024 * 1024,
  points: 10000,
  records: 10,
  totalPoints: 50000,
  hours: 24,
  historicalDays: 366,
  gapSeconds: 120,
} as const
export type JourneyPoint = {
  latitude: number
  longitude: number
  time: string | null
  accuracyMeters: number | null
  segment: number
}
export type Journey = {
  schemaVersion: 1
  id: string
  name: string
  source: 'foreground_gps' | 'gpx_import'
  importedAt: string
  status: 'recording' | 'interrupted' | 'completed'
  points: JourneyPoint[]
  interruption: string | null
}
export type JourneyLibrary = {
  schemaVersion: 1
  revision: number
  journeys: Journey[]
}
const GPX_NAMESPACE = 'http://www.topografix.com/GPX/1/1'
const finite = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
export function journeyTimestamp(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    )
  )
    return null
  const date = new Date(value)
  const day = new Date(`${value.slice(0, 10)}T12:00:00Z`)
  return Number.isFinite(date.getTime()) &&
    Number.isFinite(day.getTime()) &&
    day.toISOString().startsWith(value.slice(0, 10))
    ? date.toISOString()
    : null
}
export function validateJourney(value: unknown, now = Date.now()): Journey {
  const journey = value as Journey
  if (
    !journey ||
    journey.schemaVersion !== 1 ||
    typeof journey.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(journey.id) ||
    typeof journey.name !== 'string' ||
    !journey.name.trim() ||
    journey.name.length > 80 ||
    [...journey.name].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !['foreground_gps', 'gpx_import'].includes(journey.source) ||
    !['recording', 'interrupted', 'completed'].includes(journey.status) ||
    !journeyTimestamp(journey.importedAt) ||
    Date.parse(journey.importedAt) > now + 300000 ||
    !(
      journey.interruption === null ||
      (typeof journey.interruption === 'string' &&
        journey.interruption.length <= 120)
    ) ||
    !Array.isArray(journey.points) ||
    journey.points.length > JOURNEY_LIMITS.points
  )
    throw new Error('Journey record is invalid; original data is preserved.')
  let previousTime: number | null = null,
    previousSegment = -1,
    firstTime: number | null = null
  for (const point of journey.points) {
    if (!point) throw new Error('Journey point is invalid.')
    const time = point.time === null ? null : journeyTimestamp(point.time)
    if (
      !finite(point.latitude, -90, 90) ||
      !finite(point.longitude, -180, 180) ||
      !(
        point.accuracyMeters === null || finite(point.accuracyMeters, 0, 10000)
      ) ||
      !Number.isInteger(point.segment) ||
      point.segment < 0 ||
      point.segment < previousSegment ||
      point.segment > JOURNEY_LIMITS.points ||
      (point.time !== null && !time)
    )
      throw new Error('Journey coordinates, accuracy or time are invalid.')
    if (time) {
      const ms = Date.parse(time)
      if (ms > now + 300000 || (previousTime !== null && ms <= previousTime))
        throw new Error(
          'Journey times must be ordered and cannot be in the future.',
        )
      firstTime ??= ms
      if (ms - firstTime > JOURNEY_LIMITS.hours * 3600000)
        throw new Error('A journey can cover at most 24 hours.')
      previousTime = ms
    }
    previousSegment = point.segment
  }
  return structuredClone(journey)
}
export function validateJourneyLibrary(
  value: unknown,
  now = Date.now(),
): JourneyLibrary {
  const library = value as JourneyLibrary
  if (
    !library ||
    library.schemaVersion !== 1 ||
    !Number.isSafeInteger(library.revision) ||
    library.revision < 0 ||
    !Array.isArray(library.journeys) ||
    library.journeys.length > JOURNEY_LIMITS.records
  )
    throw new Error(
      'Journey storage version or bounds are invalid; export the original bytes for recovery.',
    )
  const journeys = library.journeys.map((journey) =>
    validateJourney(journey, now),
  )
  if (
    new Set(journeys.map((j) => j.id)).size !== journeys.length ||
    journeys.reduce((n, j) => n + j.points.length, 0) >
      JOURNEY_LIMITS.totalPoints
  )
    throw new Error('Journey storage has duplicate records or too many points.')
  return { schemaVersion: 1, revision: library.revision, journeys }
}

function unescapeXml(value: string): string {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d{1,7};|#x[\dA-Fa-f]{1,6};)/.test(value))
    throw new Error('Unsupported XML entity.')
  return value.replace(
    /&(amp|lt|gt|quot|apos|#\d{1,7}|#x[\dA-Fa-f]{1,6});/g,
    (_, entity: string) => {
      const standard: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
      }
      if (standard[entity]) return standard[entity]
      const code = entity.startsWith('#x')
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10)
      if (code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        throw new Error('Unsupported XML character.')
      return String.fromCodePoint(code)
    },
  )
}
type XmlNode = {
  name: string
  local: string
  ns: string
  namespaces: Record<string, string>
  point: JourneyPoint | null
  time: string
  trackSegment: boolean
}
/** Bounded GPX 1.1 track subset. No DTD, entities, external schema fetch, links, metadata or extensions are imported. */
export function parseLocalGpx(
  xml: string,
  name = 'Imported journey',
  now = Date.now(),
): Journey {
  if (
    typeof xml !== 'string' ||
    new TextEncoder().encode(xml).byteLength > JOURNEY_LIMITS.bytes ||
    /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)
  )
    throw new Error(
      'Use a GPX 1.1 track file up to 1 MB without DTD, entities or CDATA.',
    )
  const stack: XmlNode[] = [],
    points: JourneyPoint[] = []
  let segment = -1,
    rootSeen = false,
    rootClosed = false,
    tokens = 0
  const finish = (node: XmlNode) => {
    const parent = stack.at(-1)
    if (node.ns === GPX_NAMESPACE && node.local === 'time' && parent?.point) {
      if (parent.point.time !== null)
        throw new Error('A GPX point has duplicate timestamps.')
      const time = journeyTimestamp(node.time.trim())
      if (
        !time ||
        Date.parse(time) < now - JOURNEY_LIMITS.historicalDays * 86400000
      )
        throw new Error(
          'GPX point dates must be valid and within the last 366 days.',
        )
      parent.point.time = time
    }
    if (node.point) {
      if (points.length >= JOURNEY_LIMITS.points)
        throw new Error('GPX contains more than 10,000 track points.')
      points.push(node.point)
    }
    if (!stack.length) rootClosed = true
  }
  const parts =
    xml
      .replace(/^\uFEFF/, '')
      .match(/<!--[\s\S]*?-->|<\?xml\s[\s\S]*?\?>|<[^>]*>|[^<]+/g) || []
  if (parts.join('') !== xml.replace(/^\uFEFF/, ''))
    throw new Error('Malformed GPX XML.')
  for (const part of parts) {
    if (++tokens > 100000) throw new Error('GPX XML is too complex.')
    if (part.startsWith('<!--')) {
      if (part.slice(4, -3).includes('--'))
        throw new Error('Invalid XML comment.')
      continue
    }
    if (part.startsWith('<?')) {
      if (rootSeen || !/^<\?xml\s[^<>]*\?>$/.test(part))
        throw new Error('Unsupported XML instruction.')
      continue
    }
    if (!part.startsWith('<')) {
      if (!stack.length && part.trim())
        throw new Error('Text outside GPX root.')
      if (part.includes(']]>')) throw new Error('Invalid XML text.')
      const decoded = unescapeXml(part)
      if (stack.at(-1)?.local === 'time')
        stack[stack.length - 1].time += decoded
      continue
    }
    const closing = /^<\/([\w:.-]+)\s*>$/.exec(part)
    if (closing) {
      const node = stack.pop()
      if (!node || node.name !== closing[1])
        throw new Error('GPX tags do not match.')
      finish(node)
      continue
    }
    const opening = /^<([\w:.-]+)([\s\S]*?)\s*(\/?)>$/.exec(part)
    if (!opening || rootClosed || stack.length >= 16)
      throw new Error('Unsupported or deeply nested GPX XML.')
    const attrs: Record<string, string> = {},
      tail = opening[2]
    let offset = 0
    while (offset < tail.length) {
      if (!tail.slice(offset).trim()) break
      const attr = /^\s+([\w:.-]+)\s*=\s*(["'])([^<]*?)\2/.exec(
        tail.slice(offset),
      )
      if (
        !attr ||
        Object.hasOwn(attrs, attr[1]) ||
        Object.keys(attrs).length >= 16
      )
        throw new Error('Malformed or excessive GPX attributes.')
      attrs[attr[1]] = unescapeXml(attr[3])
      offset += attr[0].length
    }
    const namespaces = { ...(stack.at(-1)?.namespaces || {}) }
    for (const [key, value] of Object.entries(attrs))
      if (key === 'xmlns') namespaces[''] = value
      else if (key.startsWith('xmlns:')) namespaces[key.slice(6)] = value
    const names = opening[1].split(':')
    if (
      names.length > 2 ||
      !/^[A-Za-z_]/.test(names[0]) ||
      (names.length === 2 && !namespaces[names[0]])
    )
      throw new Error('Invalid GPX namespace.')
    const local = names.at(-1)!,
      ns = namespaces[names.length === 2 ? names[0] : ''] || '',
      parent = stack.at(-1)
    if (!rootSeen) {
      if (
        local !== 'gpx' ||
        ns !== GPX_NAMESPACE ||
        attrs.version !== '1.1' ||
        !attrs.creator
      )
        throw new Error('Only namespaced GPX 1.1 tracks are supported.')
      rootSeen = true
    }
    const node: XmlNode = {
      name: opening[1],
      local,
      ns,
      namespaces,
      point: null,
      time: '',
      trackSegment: false,
    }
    if (
      ns === GPX_NAMESPACE &&
      local === 'trkseg' &&
      parent?.local === 'trk' &&
      parent.ns === GPX_NAMESPACE &&
      stack.length === 2 &&
      stack[0].local === 'gpx' &&
      stack[0].ns === GPX_NAMESPACE
    ) {
      segment++
      node.trackSegment = true
    }
    if (
      ns === GPX_NAMESPACE &&
      local === 'trkpt' &&
      parent?.local === 'trkseg' &&
      parent.ns === GPX_NAMESPACE &&
      parent.trackSegment
    ) {
      if (
        !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(attrs.lat || '') ||
        !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(attrs.lon || '')
      )
        throw new Error('GPX point coordinates are invalid.')
      node.point = {
        latitude: Number(attrs.lat),
        longitude: Number(attrs.lon),
        time: null,
        accuracyMeters: null,
        segment: Math.max(0, segment),
      }
    }
    stack.push(node)
    if (opening[3]) finish(stack.pop()!)
  }
  if (!rootSeen || !rootClosed || stack.length || !points.length)
    throw new Error('GPX contains no complete track points.')
  // A long timestamp gap starts a new local segment, even if the file omitted a GPX segment break.
  let normalizedSegment = 0,
    previousOriginalSegment: number | null = null
  points.forEach((point, i) => {
    const previous = points[i - 1]
    const originalSegment = point.segment
    if (
      previous &&
      (originalSegment !== previousOriginalSegment ||
        point.time === null ||
        previous.time === null ||
        Date.parse(point.time) - Date.parse(previous.time) >
          JOURNEY_LIMITS.gapSeconds * 1000)
    )
      normalizedSegment++
    previousOriginalSegment = originalSegment
    point.segment = normalizedSegment
  })
  return validateJourney(
    {
      schemaVersion: 1,
      id: globalThis.crypto.randomUUID(),
      name: name.trim().slice(0, 80) || 'Imported journey',
      source: 'gpx_import',
      importedAt: new Date(now).toISOString(),
      status: 'completed',
      points,
      interruption: null,
    },
    now,
  )
}

export function newForegroundJourney(name: string, now = Date.now()): Journey {
  return {
    schemaVersion: 1,
    id: globalThis.crypto.randomUUID(),
    name: name.trim().slice(0, 80) || 'Local journey',
    source: 'foreground_gps',
    importedAt: new Date(now).toISOString(),
    status: 'recording',
    points: [],
    interruption: null,
  }
}
export function appendForegroundPoint(
  journey: Journey,
  point: Omit<JourneyPoint, 'segment'>,
  now = Date.now(),
): Journey {
  if (journey.status !== 'recording')
    throw new Error('Start a new foreground recording first.')
  const previous = journey.points.at(-1)
  if (
    !point.time ||
    !journeyTimestamp(point.time) ||
    now - Date.parse(point.time) > 120000 ||
    point.accuracyMeters === null ||
    point.accuracyMeters > 1000
  )
    throw new Error(
      'A recent GPS fix with reported accuracy up to 1,000 metres is required.',
    )
  const gap =
    previous &&
    (!previous.time ||
      Date.parse(point.time) - Date.parse(previous.time) >
        JOURNEY_LIMITS.gapSeconds * 1000)
  return validateJourney(
    {
      ...journey,
      points: [
        ...journey.points,
        { ...point, segment: (previous?.segment || 0) + (gap ? 1 : 0) },
      ],
    },
    now,
  )
}
export function summarizeJourney(journey: Journey) {
  let metres = 0,
    observedSeconds = 0,
    gaps = 0
  const rad = (v: number) => (v * Math.PI) / 180
  journey.points.forEach((point, i) => {
    const previous = journey.points[i - 1]
    if (!previous) return
    const seconds =
      point.time && previous.time
        ? (Date.parse(point.time) - Date.parse(previous.time)) / 1000
        : null
    if (
      point.segment !== previous.segment ||
      seconds === null ||
      seconds > JOURNEY_LIMITS.gapSeconds
    ) {
      gaps++
      return
    }
    const a =
      Math.sin(rad(point.latitude - previous.latitude) / 2) ** 2 +
      Math.cos(rad(previous.latitude)) *
        Math.cos(rad(point.latitude)) *
        Math.sin(rad(point.longitude - previous.longitude) / 2) ** 2
    metres +=
      6371000 *
      2 *
      Math.atan2(Math.sqrt(Math.min(1, a)), Math.sqrt(Math.max(0, 1 - a)))
    observedSeconds += seconds
  })
  return {
    metres,
    observedSeconds,
    gaps,
    missingTimePoints: journey.points.filter((point) => point.time === null)
      .length,
    pointCount: journey.points.length,
    exposure: null,
    exposureReason: 'No compatible historical pollution feed is connected.',
  }
}
const escapeXml = (v: string) =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
export function exportJourneyGpx(journey: Journey) {
  const clean = validateJourney(journey)
  let segment: number | null = null,
    body = ''
  for (const point of clean.points) {
    if (segment !== point.segment) {
      if (segment !== null) body += '</trkseg>'
      body += '<trkseg>'
      segment = point.segment
    }
    body += `<trkpt lat="${point.latitude}" lon="${point.longitude}">${point.time ? `<time>${point.time}</time>` : ''}</trkpt>`
  }
  if (segment !== null) body += '</trkseg>'
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Airday local journey" xmlns="${GPX_NAMESPACE}"><trk><name>${escapeXml(clean.name)}</name>${body}</trk></gpx>`
}
export function addJourney(
  library: JourneyLibrary,
  journey: Journey,
  now = Date.now(),
): JourneyLibrary {
  const clean = validateJourney(journey, now)
  const same = (a: Journey, b: Journey) =>
    a.source === 'gpx_import' &&
    b.source === 'gpx_import' &&
    JSON.stringify(a.points) === JSON.stringify(b.points)
  if (
    library.journeys.some(
      (existing) => existing.id !== clean.id && same(existing, clean),
    )
  )
    throw new Error('This track has already been imported.')
  return validateJourneyLibrary(
    {
      ...library,
      journeys: [
        clean,
        ...library.journeys.filter((existing) => existing.id !== clean.id),
      ],
    },
    now,
  )
}
