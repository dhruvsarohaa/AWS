import type { ActivityView } from './activity-view.ts'
import { localFingerprint } from './decision-evidence.ts'
import { planVersion } from './planner.ts'
export type ReviewAlert = {
  id: string
  activityId: string
  activity: string
  status: ActivityView['status']
  reasons: string[]
}

export type ReviewEpisode = {
  signature: string
  cycle: number
  value: number | null
}
export function reviewSignals(
  views: ActivityView[],
  date: string,
  locationKey: string,
) {
  return views
    .filter((v) => v.status !== 'preview')
    .map((v) => {
      const scope = localFingerprint(
        JSON.stringify([
          locationKey,
          date,
          v.id,
          planVersion(v.contextPlan),
          v.current?.id || v.latest?.id || '',
        ]),
      )
      const signature = localFingerprint(
        JSON.stringify([
          v.status,
          v.chosen.coverage,
          v.chosen.review,
          v.reasons,
          v.passed,
        ]),
      )
      const attention =
        !v.passed &&
        v.unresolved &&
        ['review', 'recheck', 'reopened', 'incomplete', 'unavailable'].includes(
          v.status,
        )
      return {
        scope,
        signature,
        value: v.chosen.value,
        alert: attention
          ? {
              id: '',
              activityId: v.id,
              activity: v.activity,
              status: v.status,
              reasons: v.reasons,
            }
          : null,
      }
    })
}

export type ReviewSignal = ReturnType<typeof reviewSignals>[number]

/** Deterministic episode transition shared by the live hook and regression checks. */
export function evaluateReviewAlerts(
  signals: ReviewSignal[],
  dismissed: string[],
  previous = new Map<string, ReviewEpisode>(),
) {
  const memory = new Map(previous)
  const alerts: ReviewAlert[] = []
  for (const signal of signals) {
    let episode = memory.get(signal.scope)
    if (!episode) {
      const candidate = [...dismissed]
        .reverse()
        .find((id) => id.startsWith(`r1:${signal.scope}:`))
        ?.split(':')
      const parts =
        candidate?.length === 5 &&
        /^[a-f0-9]{32}$/.test(candidate[2]) &&
        Number.isSafeInteger(Number(candidate[3])) &&
        Number(candidate[3]) >= 0 &&
        (candidate[4] === 'null' || Number.isFinite(Number(candidate[4])))
          ? candidate
          : undefined
      episode = parts
        ? {
            signature: parts[2],
            cycle: Number(parts[3]),
            value: parts[4] === 'null' ? null : Number(parts[4]),
          }
        : { signature: signal.signature, cycle: 0, value: signal.value }
    }
    const material =
      episode.value === null || signal.value === null
        ? episode.value !== signal.value
        : Math.abs(signal.value - episode.value) >
          Math.max(5, Math.abs(episode.value) * 0.2)
    if (episode.signature !== signal.signature || material)
      episode = {
        signature: signal.signature,
        cycle: episode.cycle + 1,
        value: signal.value,
      }
    memory.set(signal.scope, episode)
    const id = `r1:${signal.scope}:${episode.signature}:${episode.cycle}:${episode.value}`
    if (signal.alert && !dismissed.includes(id))
      alerts.push({ ...signal.alert, id })
  }
  if (memory.size > 500) {
    const scopes = new Set(signals.map((signal) => signal.scope))
    for (const key of memory.keys()) if (!scopes.has(key)) memory.delete(key)
  }
  return { alerts, memory }
}
