import type { DecisionRecord, Language } from '../types.ts'
import { say } from './labels.ts'
export type ReportOptions = { includePrivate?: boolean }
/** Private labels/reasons are opt-in. Coordinates are never report fields. */
export function reportDetails(
  record: DecisionRecord,
  options: ReportOptions = {},
  language: Language = 'en',
) {
  const privateValue = (value: string | undefined) =>
    options.includePrivate
      ? value ||
        say(language, 'Not retained (legacy)', 'पुराने रिकॉर्ड में दर्ज नहीं')
      : say(language, 'Withheld', 'निजी विवरण शामिल नहीं')
  return {
    activity: privateValue(record.activity),
    plan: privateValue(record.reviewedPlanName),
    location: privateValue(
      record.location
        ? `${record.location.name}${record.location.state ? `, ${record.location.state}` : ''}`
        : undefined,
    ),
    reason: privateValue(record.reason),
  }
}
export function retainedConcentration(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}
/** CSV quoting plus spreadsheet formula neutralization. All columns are frozen record fields. */
const cell = (value: unknown) => {
  let text = value == null ? '' : String(value)
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
export function decisionCsv(
  records: DecisionRecord[],
  options: ReportOptions = {},
) {
  const header = [
    'record_id',
    'date',
    'location',
    'plan_at_review',
    'activity',
    'kind',
    'original_start_IST',
    'original_end_IST',
    'chosen_start_IST',
    'chosen_end_IST',
    'action',
    'reason',
    'rule_PM2_5_ug_m3',
    'original_peak_ug_m3',
    'chosen_peak_ug_m3',
    'original_coverage',
    'chosen_coverage',
    'original_freshness_at_review',
    'forecast_freshness_at_review',
    'forecast_source',
    'forecast_retrieved_at',
    'snapshot_id',
    'plan_version',
    'guidance_version',
    'guidance_status',
    'lifecycle',
    'reopened_at',
    'superseded_by',
    'follow_through',
    'recorded_at',
    'model_estimate_method',
    'original_model_concentration_time_ug_h_m3',
    'chosen_model_concentration_time_ug_h_m3',
  ]
  const rows = records.map((r) => {
    const details = reportDetails(r, options)
    return [
      r.id,
      r.date,
      details.location,
      details.plan,
      details.activity,
      r.kind || 'scheduled',
      r.originalWindow?.start,
      r.originalWindow?.end,
      r.chosenWindow?.start,
      r.chosenWindow?.end,
      r.choice,
      details.reason,
      r.threshold,
      retainedConcentration(r.originalAssessment?.value),
      retainedConcentration(r.chosenAssessment?.value),
      r.originalAssessment?.coverage || 'unknown',
      r.chosenAssessment?.coverage || 'unknown',
      r.originalAssessment?.freshness || 'unknown',
      r.chosenAssessment?.freshness || 'unknown',
      r.forecastSource || 'Not retained (legacy)',
      r.sourceAt || 'Not retained (legacy)',
      r.snapshotId,
      r.planVersion,
      r.policyVersion,
      r.policyStatus,
      r.lifecycle || 'legacy',
      r.reopenedAt,
      r.supersededBy,
      r.followThrough,
      r.at,
      r.modelEstimate?.method,
      r.modelEstimate?.original,
      r.modelEstimate?.chosen,
    ]
  })
  return (
    '\uFEFF' +
    [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
  )
}
export function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
