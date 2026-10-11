import type { DashboardData, Pollutant } from '../types.ts'
export type Interval = { start: string; end: string; value: number | null }
export const POLLUTANTS: Record<Pollutant, string> = {
  pm25: 'PM2.5',
  pm10: 'PM10',
  no2: 'NO₂',
  o3: 'O₃',
  so2: 'SO₂',
  co: 'CO',
}
const validDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(`${date}T12:00:00Z`)) &&
  new Date(`${date}T12:00:00Z`).toISOString().startsWith(date)
/** Validate editable fields before calling toISOString; blank/native-invalid inputs
 * are an unavailable window, never a render-time RangeError. */
export function periodWindow(date: string, start: string, hours: number) {
  if (
    !validDate(date) ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) ||
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > 24
  )
    return null
  const beginning = `${date}T${start}:00+05:30`
  return {
    start: beginning,
    end: new Date(Date.parse(beginning) + hours * 3600000).toISOString(),
  }
}
/** Explicit display approximation: each hourly API sample is held for one hour.
 * Do not bridge missing hours, null values, source changes, or overlapping intervals. */
export function modelIntervals(
  data: DashboardData | null,
  key: Pollutant,
): Interval[] {
  const f = data?.forecast
  if (!f) return []
  const series = f.pollutants?.[key]
  if (
    series &&
    (series.schemaVersion !== 1 ||
      series.unit !== 'µg/m³' ||
      series.source !== f.source ||
      series.statistic !== 'model_sample' ||
      series.stepMinutes !== 60 ||
      series.values.length !== f.points.length ||
      !series.values.every(
        (p, index) =>
          p.time === f.points[index].time &&
          ((key !== 'pm25' && key !== 'pm10') ||
            p.value === f.points[index][key]),
      ))
  )
    return []
  const values =
    series?.values ||
    (key === 'pm25' || key === 'pm10'
      ? f.points.map((p) => ({ time: p.time, value: p[key] }))
      : [])
  return values
    .filter(
      (p) =>
        validDate(p.time.slice(0, 10)) && Number.isFinite(Date.parse(p.time)),
    )
    .map((p) => ({
      start: p.time,
      end: new Date(Date.parse(p.time) + 3600000).toISOString(),
      value:
        p.value === null || (Number.isFinite(p.value) && p.value >= 0)
          ? p.value
          : null,
    }))
}
export function integrate(intervals: Interval[], start: string, end: string) {
  const a = Date.parse(start),
    b = Date.parse(end),
    duration = (b - a) / 3600000
  let covered = 0,
    total = 0,
    count = 0,
    previousEnd = -Infinity,
    overlapping = false
  const included: Interval[] = []
  if (!Number.isFinite(duration) || duration <= 0)
    return {
      duration: 0,
      covered: 0,
      total: null,
      mean: null,
      complete: false,
      count: 0,
      included,
    }
  for (const i of [...intervals].sort(
    (x, y) => Date.parse(x.start) - Date.parse(y.start),
  )) {
    const from = Math.max(a, Date.parse(i.start)),
      to = Math.min(b, Date.parse(i.end))
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue
    if (from < previousEnd) overlapping = true
    previousEnd = Math.max(previousEnd, to)
    if (i.value === null || !Number.isFinite(i.value) || i.value < 0) continue
    const hours = (to - from) / 3600000
    covered += hours
    total += i.value * hours
    count++
    included.push({
      ...i,
      start: new Date(from).toISOString(),
      end: new Date(to).toISOString(),
    })
  }
  const complete =
    !overlapping &&
    Number.isFinite(total) &&
    Math.abs(covered - duration) < 1e-7
  return {
    duration,
    covered: overlapping ? 0 : covered,
    total: complete ? total : null,
    mean: complete ? total / duration : null,
    complete,
    count,
    included,
  }
}
export function activityEstimate(
  data: DashboardData | null,
  date: string,
  start: string,
  end: string,
) {
  const window = periodWindow(date, start, 1)
  const finish = periodWindow(date, end, 1)
  return integrate(
    modelIntervals(data, 'pm25'),
    window?.start || '',
    finish?.start || '',
  )
}
