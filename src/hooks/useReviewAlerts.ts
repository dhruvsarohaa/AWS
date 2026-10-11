import { useEffect, useRef, useState } from 'react'
import type { ActivityView } from '../lib/activity-view.ts'
import { evaluateReviewAlerts, reviewSignals } from '../lib/review-alerts.ts'
import type { ReviewAlert, ReviewEpisode } from '../lib/review-alerts.ts'
/** In-app episodes only. No background delivery or timers that claim to notify offline. */
export function useReviewAlerts(
  views: ActivityView[],
  date: string,
  locationKey: string,
  dismissed: string[],
  enabled = true,
) {
  const memory = useRef(new Map<string, ReviewEpisode>()),
    [state, setAlerts] = useState<{ basis: string; alerts: ReviewAlert[] }>({
      basis: '',
      alerts: [],
    })
  const signals = JSON.stringify(reviewSignals(views, date, locationKey)),
    storedDismissals = JSON.stringify(dismissed)
  const basis = JSON.stringify([locationKey, date, signals, storedDismissals])
  useEffect(() => {
    if (!enabled) return
    const hidden: string[] = JSON.parse(storedDismissals),
      input: ReturnType<typeof reviewSignals> = JSON.parse(signals)
    const result = evaluateReviewAlerts(input, hidden, memory.current)
    memory.current = result.memory
    // Stateful episodes synchronize with incoming provider snapshots, not just display formatting.
    // oxlint-disable-next-line react/set-state-in-effect
    setAlerts((previous) =>
      previous.basis === basis &&
      JSON.stringify(previous.alerts) === JSON.stringify(result.alerts)
        ? previous
        : { basis, alerts: result.alerts },
    )
  }, [signals, storedDismissals, basis, enabled])
  return enabled && state.basis === basis ? state.alerts : []
}
