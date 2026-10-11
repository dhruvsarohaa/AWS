import type { Activity, ForecastPoint } from '../types.ts'
import { assessActivity, clockMinutes, pointsForDate } from './planner.ts'

export type TimeOption = {
  start: string
  end: string
  value: number
  mean: number
  review: boolean
}
const time = (minutes: number) =>
  `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`
/** Hour buckets are model output, not street observations. No interpolation across gaps. */
export function windowMean(
  points: ForecastPoint[],
  start: string,
  end: string,
): number | null {
  const a = clockMinutes(start),
    b = clockMinutes(end)
  let weighted = 0,
    covered = 0
  for (let hour = 0; hour < 24; hour++) {
    const overlap = Math.max(
      0,
      Math.min(b, (hour + 1) * 60) - Math.max(a, hour * 60),
    )
    if (!overlap) continue
    const value = points[hour]?.pm25
    if (value == null || !Number.isFinite(value) || value < 0) return null
    weighted += value * overlap
    covered += overlap
  }
  return covered === b - a && covered > 0 ? weighted / covered : null
}
export function searchTimes(input: {
  points: ForecastPoint[]
  date: string
  duration: number
  allowedStart: string
  allowedEnd: string
  threshold: number
  now: number
  excludeStart?: string
  lowerThan?: number | null
}): TimeOption[] {
  const a = clockMinutes(input.allowedStart),
    b = clockMinutes(input.allowedEnd),
    dateAt = Date.parse(`${input.date}T12:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(dateAt) ||
    new Date(dateAt).toISOString().slice(0, 10) !== input.date ||
    !Number.isFinite(input.now) ||
    !Number.isFinite(input.threshold) ||
    input.threshold < 1 ||
    input.threshold > 1000 ||
    (input.lowerThan != null &&
      (!Number.isFinite(input.lowerThan) || input.lowerThan < 0)) ||
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    b <= a ||
    !Number.isInteger(input.duration) ||
    input.duration < 15 ||
    input.duration > 240 ||
    input.duration > b - a
  )
    return []
  const points = pointsForDate(input.points, input.date),
    candidates: TimeOption[] = []
  for (let minute = a; minute + input.duration <= b; minute += 15) {
    const start = time(minute),
      end = time(minute + input.duration)
    if (
      start === input.excludeStart ||
      Date.parse(`${input.date}T${start}:00+05:30`) <= input.now
    )
      continue
    const activity: Activity = {
      id: 'candidate',
      activity: 'Candidate',
      place: '',
      start,
      end,
      days: [0, 1, 2, 3, 4, 5, 6],
    }
    const assessment = assessActivity(
      activity,
      points,
      input.date,
      input.threshold,
      input.now,
    )
    const mean = windowMean(points, start, end)
    if (
      assessment.coverage !== 'complete' ||
      assessment.value === null ||
      mean === null ||
      (input.lowerThan != null && assessment.value >= input.lowerThan)
    )
      continue
    candidates.push({
      start,
      end,
      value: assessment.value,
      mean,
      review: assessment.review,
    })
  }
  candidates.sort(
    (x, y) =>
      x.value - y.value ||
      x.mean - y.mean ||
      clockMinutes(x.start) - clockMinutes(y.start),
  )
  const result: TimeOption[] = []
  for (const item of candidates) {
    if (
      result.every(
        (previous) =>
          Math.abs(clockMinutes(previous.start) - clockMinutes(item.start)) >=
          input.duration,
      )
    )
      result.push(item)
    if (result.length === 3) break
  }
  return result
}
