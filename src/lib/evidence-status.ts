import type { DashboardData, Monitor, SourceStatus } from '../types.ts'
import { timestampState } from './planner.ts'

const retrievalLabels: Record<SourceStatus['status'], string> = {
  live: 'Feed retrieved',
  stale: 'Previous retrieval is old',
  not_configured: 'Not connected',
  unavailable: 'Unavailable',
  no_data: 'No new nearby reading',
  pending: 'Retrieval queued',
  unverified: 'Metadata not verified',
}

const retrievalMessages: Record<SourceStatus['status'], string> = {
  live: 'Provider evidence is available.',
  stale: 'Previously retrieved evidence remains available.',
  not_configured: 'This provider is not connected on this deployment.',
  unavailable:
    'Provider retrieval failed. Previously retrieved evidence remains available.',
  no_data: 'The latest retrieval returned no usable nearby observation.',
  pending: 'Provider retrieval is queued.',
  unverified: 'Provider measurement metadata requires review.',
}

export function providerPresentation(
  status: SourceStatus,
  monitor: Monitor | undefined,
  now: number,
) {
  const age = monitor ? timestampState(monitor.observedAt, now) : null
  return {
    retrievalLabel:
      status.status === 'unavailable' &&
      (status.lastAttemptAt || status.lastSuccessAt || monitor)
        ? 'Refresh failed'
        : retrievalLabels[status.status],
    message: status.message ?? retrievalMessages[status.status],
    observationLabel: monitor
      ? age === 'fresh'
        ? 'Recent reading'
        : age === 'stale'
          ? 'Old observation'
          : 'Observation time unverified'
      : null,
    lastSuccessAt: status.lastSuccessAt ?? null,
    lastAttemptAt: status.lastAttemptAt ?? null,
    failed: status.status === 'unavailable',
  }
}

export function coverageState(data: DashboardData, now: number): string {
  const hasCurrent = data.monitors.some(
    (monitor) => timestampState(monitor.observedAt, now) === 'fresh',
  )
  return data.forecast
    ? hasCurrent
      ? 'forecast_and_observation'
      : data.monitors.length
        ? 'forecast_and_old_observation'
        : 'forecast_only'
    : data.monitors.length
      ? 'observations_only'
      : data.pending
        ? 'pending'
        : 'unavailable'
}
