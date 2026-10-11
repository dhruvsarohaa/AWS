import type { Activity, ForecastPoint, OutdoorPlan } from '../types.ts'

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const EXAMPLE_THRESHOLD = 75
export const MONITOR_MAX_AGE = 3 * 60 * 60 * 1000
export const FORECAST_MAX_AGE = 2 * 60 * 60 * 1000
export const DEFAULT_PLACE = {
  name: 'New Delhi',
  state: 'Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
  confirmed: false,
}
export const STARTER_PLAN: OutdoorPlan = {
  name: 'My outdoor plan',
  threshold: EXAMPLE_THRESHOLD,
  ruleMode: 'example',
  configured: false,
  activities: [
    {
      id: 'starter-commute',
      start: '08:00',
      end: '09:00',
      activity: 'Morning commute',
      place: 'Outside',
      days: [1, 2, 3, 4, 5],
    },
    {
      id: 'starter-lunch',
      start: '12:30',
      end: '13:00',
      activity: 'Lunch break',
      place: 'Outside',
      days: [1, 2, 3, 4, 5],
    },
    {
      id: 'starter-walk',
      start: '17:00',
      end: '18:00',
      activity: 'Evening walk',
      place: 'Outside',
      days: [0, 1, 2, 3, 4, 5, 6],
    },
  ],
}

export function dateInIndia(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  )
  return `${values.year}-${values.month}-${values.day}`
}
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
export function formatDate(
  value: string,
  options: Intl.DateTimeFormatOptions = {},
) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    ...options,
  }).format(new Date(value))
}
export function dateLabel(date: string, now: number) {
  const today = dateInIndia(now)
  return date === today
    ? 'Today'
    : date === addDays(today, 1)
      ? 'Tomorrow'
      : formatDate(`${date}T12:00:00+05:30`, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
}
export function formatTimestamp(value: string | null | undefined, now: number) {
  if (!value || !Number.isFinite(Date.parse(value)))
    return 'Time not supplied by source'
  const age = now - Date.parse(value)
  const when = formatDate(value, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
  const relative =
    age < -60_000
      ? 'timestamp ahead of device clock'
      : age < 60_000
        ? 'just now'
        : age < 3_600_000
          ? `${Math.floor(age / 60_000)} min ago`
          : `${Math.floor(age / 3_600_000)} hr ago`
  return `${when} IST · ${relative}`
}
export function timestampState(
  value: string | null | undefined,
  now: number,
  maxAge = MONITOR_MAX_AGE,
) {
  const at = value ? Date.parse(value) : NaN
  if (!Number.isFinite(at)) return 'unknown' as const
  if (at > now + 5 * 60_000) return 'future' as const
  return now - at > maxAge ? ('stale' as const) : ('fresh' as const)
}
export function concentration(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) || value < 0
    ? 'Not available'
    : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)
}
export function clockMinutes(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}
export function pointsForDate(
  points: ForecastPoint[],
  date: string,
): ForecastPoint[] {
  const rows = new Map(
    points
      .filter((point) => point.time.startsWith(date))
      .map((point) => [point.time.slice(11, 16), point]),
  )
  const valid = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : null
  return Array.from({ length: 24 }, (_, hour) => {
    const clock = `${String(hour).padStart(2, '0')}:00`
    const row = rows.get(clock)
    return {
      time: `${date}T${clock}:00+05:30`,
      pm25: valid(row?.pm25),
      pm10: valid(row?.pm10),
    }
  })
}
export function assessActivity(
  activity: Activity,
  points: ForecastPoint[],
  date: string,
  threshold: number,
  now: number,
) {
  const start = clockMinutes(activity.start),
    end = clockMinutes(activity.end)
  const expected =
    Number.isFinite(start) && Number.isFinite(end) && end > start
      ? Math.ceil(end / 60) - Math.floor(start / 60)
      : 0
  const window = points.filter((point) => {
    const minute = clockMinutes(point.time.slice(11, 16))
    return point.time.startsWith(date) && minute < end && minute + 60 > start
  })
  const values = window
    .map((point) => point.pm25)
    .filter(
      (value): value is number =>
        value !== null && Number.isFinite(value) && value >= 0,
    )
  const value = values.length ? Math.max(...values) : null
  const coverage = !values.length
    ? 'missing'
    : values.length < expected
      ? 'partial'
      : 'complete'
  const passed = now >= Date.parse(`${date}T${activity.end}:00+05:30`)
  const underway =
    !passed && now >= Date.parse(`${date}T${activity.start}:00+05:30`)
  return {
    ...activity,
    value,
    expected,
    available: values.length,
    coverage,
    review: value !== null && value > threshold,
    passed,
    underway,
  }
}
export function summarizeActivities(
  locationConfirmed: boolean,
  planConfigured: boolean,
  hasForecast: boolean,
  activities: ReturnType<typeof assessActivity>[],
) {
  const active = activities.filter((item) => !item.passed)
  const flagged = active.filter((item) => item.review)
  const incomplete = active.filter((item) => item.coverage !== 'complete')
  const firstAttention = active.find(
    (item) => item.review || item.coverage !== 'complete',
  )
  const kind = !locationConfirmed
    ? 'location-preview'
    : !planConfigured
      ? 'plan-preview'
      : !hasForecast
        ? 'loading'
        : !activities.length
          ? 'empty'
          : !active.length
            ? 'finished'
            : flagged.length
              ? 'review'
              : incomplete.length
                ? 'incomplete'
                : 'below-rule'
  return { active, flagged, incomplete, firstAttention, kind }
}
export function validatePlan(plan: OutdoorPlan) {
  const errors: Record<string, string> = {}
  if (!plan.name.trim() || plan.name.length > 80)
    errors['plan-name'] = 'Enter a name up to 80 characters.'
  if (
    plan.activities.length > 50 ||
    new Set(plan.activities.map((item) => item.id)).size !==
      plan.activities.length
  )
    errors['plan-name'] = 'Use up to 50 activities with unique IDs.'
  if (
    !Number.isFinite(plan.threshold) ||
    plan.threshold < 1 ||
    plan.threshold > 1000
  )
    errors['plan-threshold'] = 'Choose a number from 1 to 1000 µg/m³.'
  for (const activity of plan.activities) {
    if (!activity.activity.trim())
      errors[`${activity.id}-name`] = 'Name this activity.'
    if (!activity.place.trim())
      errors[`${activity.id}-place`] = 'Enter where this activity takes place.'
    if (!Number.isFinite(clockMinutes(activity.start)))
      errors[`${activity.id}-start`] = 'Enter a valid start time.'
    if (!Number.isFinite(clockMinutes(activity.end)))
      errors[`${activity.id}-end`] = 'Enter a valid end time.'
    else if (clockMinutes(activity.end) <= clockMinutes(activity.start))
      errors[`${activity.id}-end`] =
        'End time must be after start time on the same day.'
    if (
      !activity.days.length ||
      activity.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    )
      errors[`${activity.id}-days`] = 'Choose at least one day.'
    if (
      activity.flexible &&
      (!Number.isFinite(clockMinutes(activity.allowedStart || '')) ||
        !Number.isFinite(clockMinutes(activity.allowedEnd || '')) ||
        clockMinutes(activity.allowedEnd || '') -
          clockMinutes(activity.allowedStart || '') <
          clockMinutes(activity.end) - clockMinutes(activity.start))
    )
      errors[`${activity.id}-allowed-start`] =
        'Choose an allowed time range that can fit this activity.'
  }
  return errors
}

export function alternativeWindows(
  activity: Activity,
  points: ForecastPoint[],
  date: string,
  threshold: number,
  now: number,
) {
  if (!activity.flexible) return []
  const duration = clockMinutes(activity.end) - clockMinutes(activity.start)
  const from = clockMinutes(activity.allowedStart || ''),
    to = clockMinutes(activity.allowedEnd || '')
  if (
    ![duration, from, to].every(Number.isFinite) ||
    duration <= 0 ||
    to - from < duration
  )
    return []
  const clock = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  const existing = assessActivity(activity, points, date, threshold, now)
  if (existing.coverage !== 'complete' || existing.value === null) return []
  const options = []
  for (
    let start = Math.ceil(from / 15) * 15;
    start + duration <= to;
    start += 15
  ) {
    if (
      start === clockMinutes(activity.start) ||
      Date.parse(`${date}T${clock(start)}:00+05:30`) <= now
    )
      continue
    const candidate = assessActivity(
      { ...activity, start: clock(start), end: clock(start + duration) },
      points,
      date,
      threshold,
      now,
    )
    if (
      candidate.coverage === 'complete' &&
      candidate.value !== null &&
      candidate.value < existing.value
    )
      options.push(candidate)
  }
  return options
    .sort(
      (a, b) =>
        a.value! - b.value! ||
        Math.abs(clockMinutes(a.start) - clockMinutes(activity.start)) -
          Math.abs(clockMinutes(b.start) - clockMinutes(activity.start)),
    )
    .filter((item, index, all) =>
      all
        .slice(0, index)
        .every(
          (previous) =>
            Math.abs(clockMinutes(item.start) - clockMinutes(previous.start)) >=
            duration,
        ),
    )
    .slice(0, 3)
}
export function planVersion(plan: OutdoorPlan) {
  let value = 2166136261
  const normalized = {
    name: plan.name.trim(),
    threshold: plan.threshold,
    ruleMode: plan.ruleMode === 'example' ? 'example' : 'custom',
    configured: Boolean(plan.configured),
    activities: plan.activities.map((item) => ({
      id: item.id,
      activity: item.activity.trim(),
      place: item.place.trim(),
      start: item.start,
      end: item.end,
      days: [...new Set(item.days)].sort(),
      flexible: Boolean(item.flexible),
      allowedStart: item.allowedStart || item.start,
      allowedEnd: item.allowedEnd || item.end,
      indoorAvailable: Boolean(item.indoorAvailable),
      intensity: item.intensity || 'moderate',
    })),
  }
  for (const character of JSON.stringify(normalized))
    value = Math.imul(value ^ character.charCodeAt(0), 16777619)
  return (value >>> 0).toString(16)
}
