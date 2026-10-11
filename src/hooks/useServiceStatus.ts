import { useEffect, useState } from 'react'

export type ServiceConfig = {
  schemaVersion: 2
  releaseScope: 'R0R2' | 'Full'
  capabilities: {
    sharedWorkspaces: boolean
    localGroups: boolean
    reviewEmail: boolean
    publicEvidence: boolean
    weather: boolean
    fires: boolean
    r4?: { localJourneys?: boolean }
    r5?: { indoorDevices?: boolean }
  }
}

export function useServiceStatus() {
  const [config, setConfig] = useState<ServiceConfig | null>(null)
  const [responding, setResponding] = useState<boolean | null>(null)
  const [fixture, setFixture] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [checkedAt, setCheckedAt] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(15000),
    ])
    const API = import.meta.env.VITE_API_BASE_URL || ''
    void Promise.allSettled([
      fetch(`${API}/api/config`, { signal, cache: 'no-store' }).then(
        async (r) => {
          if (!r.ok) throw new Error('Configuration unavailable')
          const value = await r.json()
          if (
            value.schemaVersion !== 2 ||
            !['R0R2', 'Full'].includes(value.releaseScope) ||
            ![
              'sharedWorkspaces',
              'localGroups',
              'reviewEmail',
              'publicEvidence',
              'weather',
              'fires',
            ].every((key) => typeof value.capabilities?.[key] === 'boolean')
          )
            throw new Error('Unsupported configuration')
          return value as ServiceConfig
        },
      ),
      fetch(`${API}/api/health`, { signal, cache: 'no-store' }).then(
        async (r) => {
          if (!r.ok) throw new Error('Service unavailable')
          const value = await r.json()
          if (
            value.ok !== true ||
            value.version !== 2 ||
            typeof value.fixtures !== 'boolean'
          )
            throw new Error('Unsupported service response')
          return value as { fixtures: boolean }
        },
      ),
    ]).then(([settings, health]) => {
      if (controller.signal.aborted) return
      setConfig(settings.status === 'fulfilled' ? settings.value : null)
      setResponding(health.status === 'fulfilled')
      setFixture(health.status === 'fulfilled' && health.value.fixtures)
      setError(
        settings.status === 'rejected'
          ? 'Connection settings could not be loaded. Check your connection and retry; local tools remain available.'
          : health.status === 'rejected'
            ? 'The app service did not respond. Check your connection and retry; saved data remains available.'
            : '',
      )
      setCheckedAt(new Date().toISOString())
      setLoading(false)
    })
    return () => controller.abort()
  }, [attempt])
  return {
    config,
    responding,
    fixture,
    loading,
    error,
    checkedAt,
    retry: () => {
      setLoading(true)
      setError('')
      setAttempt((n) => n + 1)
    },
  }
}
