export type PublicEvidence = {
  schemaVersion: 1
  date: string
  generatedAt: string
  area: { latitude: number; longitude: number }
  pending: boolean
  forecast: {
    source: string
    unit: string
    fetchedAt: string
    age: string
    points: { time: string; pm25: number | null; pm10: number | null }[]
    attribution: string
  } | null
  observations: {
    source: string
    station: string
    value: number
    unit: string
    observedAt: string | null
    stale: boolean
    statistic: string | null
    period: { start: string; end: string } | null
    qualityFlags: string[]
    attribution: string
  }[]
  sources: Record<string, { status: string; lastSuccessAt: string | null }>
  guidance: string
}
export function validPublicEvidence(v: unknown): v is PublicEvidence {
  const x = v as PublicEvidence,
    finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n),
    time = (s: unknown) =>
      typeof s === 'string' && Number.isFinite(Date.parse(s)),
    text = (s: unknown) => typeof s === 'string' && s.length <= 2000,
    reading = (n: unknown) => n === null || (finite(n) && Number(n) >= 0)
  return Boolean(
    x &&
    x.schemaVersion === 1 &&
    /^\d{4}-\d{2}-\d{2}$/.test(x.date) &&
    time(x.generatedAt) &&
    finite(x.area?.latitude) &&
    finite(x.area?.longitude) &&
    x.area.latitude >= 6 &&
    x.area.latitude <= 38 &&
    x.area.longitude >= 68 &&
    x.area.longitude <= 98 &&
    text(x.guidance) &&
    typeof x.pending === 'boolean' &&
    ['forecast', 'openaq', 'cpcb'].every((k) => text(x.sources?.[k]?.status)) &&
    (x.forecast === null ||
      (x.forecast &&
        text(x.forecast.source) &&
        x.forecast.unit === 'µg/m³' &&
        time(x.forecast.fetchedAt) &&
        ['current', 'stale', 'unverified'].includes(x.forecast.age) &&
        Array.isArray(x.forecast.points) &&
        x.forecast.points.length <= 24 &&
        x.forecast.points.every(
          (p) => time(p.time) && reading(p.pm25) && reading(p.pm10),
        ))) &&
    Array.isArray(x.observations) &&
    x.observations.length <= 10 &&
    x.observations.every(
      (m) =>
        text(m.station) &&
        ['OpenAQ', 'CPCB / data.gov.in'].includes(m.source) &&
        finite(m.value) &&
        m.value >= 0 &&
        m.unit === 'µg/m³' &&
        (m.observedAt === null || time(m.observedAt)) &&
        typeof m.stale === 'boolean' &&
        (m.statistic === null || text(m.statistic)) &&
        (m.period === null ||
          (time(m.period?.start) &&
            time(m.period?.end) &&
            Date.parse(m.period.end) > Date.parse(m.period.start))) &&
        Array.isArray(m.qualityFlags) &&
        m.qualityFlags.length <= 20 &&
        m.qualityFlags.every(text),
    ),
  )
}
