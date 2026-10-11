import { useCallback, useEffect, useState } from 'react'
import { addDays, dateInIndia } from '../lib/planner.ts'
export type AppView = 'today' | 'plan' | 'evidence' | 'history' | 'settings'
export type ViewState = {
  view: AppView
  activityId: string
  recordId: string
  date: string
}
const views = new Set<AppView>([
  'today',
  'plan',
  'evidence',
  'history',
  'settings',
])
export function readViewState(): ViewState {
  const url = new URL(window.location.href),
    [raw, query = ''] = url.hash.slice(1).split('?'),
    args = new URLSearchParams(query)
  const aliases: Record<string, AppView> = {
    'outdoor-plan': 'plan',
    'forecast-title': 'evidence',
    'main-content': 'today',
    top: 'today',
  }
  const view = views.has(raw as AppView)
    ? (raw as AppView)
    : aliases[raw] || 'today'
  const date = url.searchParams.get('date') || '',
    today = dateInIndia()
  return {
    view,
    activityId: args.get('activity')?.slice(0, 100) || '',
    recordId: args.get('record')?.slice(0, 100) || '',
    date:
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      date >= today &&
      date <= addDays(today, 2)
        ? date
        : '',
  }
}
export function useViewState() {
  const [route, setRoute] = useState(readViewState)
  useEffect(() => {
    const update = () => setRoute(readViewState())
    window.addEventListener('hashchange', update)
    window.addEventListener('popstate', update)
    return () => {
      window.removeEventListener('hashchange', update)
      window.removeEventListener('popstate', update)
    }
  }, [])
  const navigate = useCallback(
    (
      view: AppView,
      options: {
        activityId?: string
        recordId?: string
        date?: string
        clearSelection?: boolean
      } = {},
    ) => {
      const url = new URL(window.location.href),
        args = new URLSearchParams(
          options.clearSelection ? '' : url.hash.split('?')[1] || '',
        )
      if (options.activityId !== undefined) {
        if (options.activityId) args.set('activity', options.activityId)
        else args.delete('activity')
      }
      if (options.recordId !== undefined) {
        if (options.recordId) args.set('record', options.recordId)
        else args.delete('record')
      }
      if (options.date) url.searchParams.set('date', options.date)
      url.hash = view + (args.size ? `?${args}` : '')
      if (url.href !== window.location.href)
        window.history.pushState(null, '', url)
      setRoute(readViewState())
    },
    [],
  )
  const syncDate = useCallback((date: string) => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('date') !== date) {
      url.searchParams.set('date', date)
      window.history.replaceState(null, '', url)
    }
  }, [])
  return { ...route, navigate, syncDate }
}
