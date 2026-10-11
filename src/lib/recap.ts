import type { DecisionRecord } from '../types.ts'
import { clockMinutes } from './planner.ts'
export const validRecapDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(`${date}T12:00:00Z`)) &&
  new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date
const windowMinutes = (window: DecisionRecord['originalWindow']) =>
  window &&
  /^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) &&
  /^([01]\d|2[0-3]):[0-5]\d$/.test(window.end) &&
  window.end > window.start
    ? clockMinutes(window.end) - clockMinutes(window.start)
    : null
/** Latest lifecycle row per dated place/activity; reopened/superseded never revive prior actions. */
export function recap(
  journal: DecisionRecord[],
  from: string,
  to: string,
  locationKey: string,
) {
  const latest = new Map<string, DecisionRecord>()
  for (const r of journal)
    if (
      validRecapDate(from) &&
      validRecapDate(to) &&
      from <= to &&
      r.location?.key === locationKey &&
      validRecapDate(r.date) &&
      r.date >= from &&
      r.date <= to
    )
      latest.set(JSON.stringify([r.date, r.activityId]), r)
  const rows = [...latest.values()],
    recorded = rows.filter(
      (r) =>
        r.lifecycle === 'recorded' &&
        r.choice !== 'pending' &&
        windowMinutes(r.originalWindow) !== null &&
        r.originalAssessment,
    )
  const chosenMinutes = (r: DecisionRecord) =>
    ['indoors', 'cancelled'].includes(r.choice)
      ? 0
      : windowMinutes(r.chosenWindow)
  const unknownPlannedMinutes = recorded.filter(
    (r) => chosenMinutes(r) === null,
  ).length
  return {
    rows,
    recorded,
    unresolved: rows.length - recorded.length,
    reviewedScheduledMinutes: recorded.reduce(
      (s, r) => s + (windowMinutes(r.originalWindow) ?? 0),
      0,
    ),
    chosenOutdoorMinutes: recorded.reduce(
      (s, r) => s + (chosenMinutes(r) ?? 0),
      0,
    ),
    reportedActions: recorded.filter((r) => r.followThrough === 'completed')
      .length,
    changed: recorded.filter((r) => r.followThrough === 'changed').length,
    unconfirmed: recorded.filter((r) => r.followThrough === 'unconfirmed')
      .length,
    unknownPlannedMinutes,
    reportedPlannedOutdoorMinutes: recorded
      .filter((r) => r.followThrough === 'completed')
      .reduce((s, r) => s + (chosenMinutes(r) ?? 0), 0),
  }
}

/** A deliberately private recap without retained coordinates or duplicated raw rows. */
export function privateRecapExport(
  journal: DecisionRecord[],
  from: string,
  to: string,
  location: { key: string; name: string; state: string },
  feedback: import('../types.ts').SuggestionFeedback[],
) {
  const { rows, recorded, ...counts } = recap(journal, from, to, location.key)
  return structuredClone({
    format: 'airday-recap',
    version: 1,
    from,
    to,
    privacy:
      'Private activity names, reasons and feedback are included; coordinates are excluded. No upload.',
    location: { key: location.key, name: location.name, state: location.state },
    summary: { ...counts, reviewedActivities: recorded.length },
    records: rows.map((r) => ({
      id: r.id,
      date: r.date,
      at: r.at,
      activity: r.activity,
      choice: r.choice,
      reason: r.reason,
      lifecycle: r.lifecycle,
      followThrough: r.followThrough,
      originalWindow: r.originalWindow,
      chosenWindow: r.chosenWindow,
      threshold: r.threshold,
      originalAssessment: r.originalAssessment,
      chosenAssessment: r.chosenAssessment,
      modelEstimate: r.modelEstimate,
      snapshotId: r.snapshotId,
      forecastId: r.forecastId,
      forecastSource: r.forecastSource,
      sourceAt: r.sourceAt,
    })),
    feedback: feedback.filter(
      (f) => f.locationKey === location.key && f.date >= from && f.date <= to,
    ),
  })
}
