import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { FormEvent } from 'react'
import ForecastChart from './components/ForecastChart.tsx'
import PlanEditor from './components/PlanEditor.tsx'
import DecisionEditor from './components/DecisionEditor.tsx'
import WorkspacePanel from './components/WorkspacePanel.tsx'
import { LocalGroups } from './components/GroupView.tsx'
import ContextPanels from './components/ContextPanels.tsx'
import PublicTools from './components/PublicTools.tsx'
import ServiceStatus from './components/ServiceStatus.tsx'
import ToolDrawer from './components/ToolDrawer.tsx'
import { useServiceStatus } from './hooks/useServiceStatus.ts'
import './components/R3.css'
import AppNavigation from './components/AppNavigation.tsx'
import ContextBar from './components/ContextBar.tsx'
import DayAirPreview from './components/DayAirPreview.tsx'
import FeatureShowcase from './components/FeatureShowcase.tsx'
import SettingsDirectory from './components/SettingsDirectory.tsx'
import { useAppMotion } from './hooks/useAppMotion.ts'
import NextActionCard from './components/NextActionCard.tsx'
import SetupStepper from './components/SetupStepper.tsx'
import PlanOverview from './components/PlanOverview.tsx'
import StationExplorer from './components/StationExplorer.tsx'
import FavoritePlaces from './components/FavoritePlaces.tsx'
import PollutantExplorer from './components/PollutantExplorer.tsx'
import PersonalProgress from './components/PersonalProgress.tsx'
import { appendSuggestionFeedback } from './lib/suggestion-feedback.ts'
import { offlineDashboard } from './lib/public-evidence.ts'
import HistoryTrends from './components/HistoryTrends.tsx'
import OfflineControls from './components/OfflineControls.tsx'
import {
  saveOfflineEvidence,
  readOfflineEvidence,
  clearOfflineEvidence,
} from './lib/offlineEvidence.ts'
import HelpPanel from './components/HelpPanel.tsx'
import PrivacyControls from './components/PrivacyControls.tsx'
import { readViewState, useViewState } from './hooks/useViewState.ts'
import type { AppView } from './hooks/useViewState.ts'
import {
  readStoredRecovery,
  clearMigrationRecovery,
} from './lib/localRepository.ts'
import { signOut } from './lib/auth.ts'
import ActivityTimeline from './components/ActivityTimeline.tsx'
import QuickTimeFinder from './components/QuickTimeFinder.tsx'
import ReviewAlertList from './components/ReviewAlertList.tsx'
import HistoryView from './components/HistoryView.tsx'
import LocalDataControls from './components/LocalDataControls.tsx'
import EvidenceStatus from './components/EvidenceStatus.tsx'
import GuidanceCard from './components/GuidanceCard.tsx'
import { useLocalRepository } from './hooks/useLocalRepository.ts'
import { activityViews, activityForChart } from './lib/activity-view.ts'
import type { ActivityView } from './lib/activity-view.ts'
import { useReviewAlerts } from './hooks/useReviewAlerts.ts'
import { downloadText } from './lib/reports.ts'
import { say, reviewReasonLabel } from './lib/labels.ts'
import { validDashboardForPlace, validPlace } from './lib/contracts.ts'
import {
  STARTER_PLAN,
  addDays,
  concentration,
  dateInIndia,
  DEFAULT_PLACE,
  FORECAST_MAX_AGE,
  formatTimestamp,
  pointsForDate,
  timestampState,
} from './lib/planner.ts'
import { readPlace, removeStored, writeStored } from './lib/storage.ts'
import { reviewedLocation } from './lib/decision-evidence.ts'
import {
  appendDecision,
  createDecisionRecord,
  decisionsForReview,
  reopenDecision,
} from './lib/decision-state.ts'
import { providerPresentation, coverageState } from './lib/evidence-status.ts'
import {
  freshPlanningEvidence,
  decisionSaveReviewReasons,
} from './lib/decision-save.ts'
import type {
  ActivityDecision,
  Activity,
  DecisionRecord,
  DashboardData,
  OutdoorPlan,
  Place,
} from './types.ts'
import './App.css'
import './glass.css'

const R4JourneyPanel = lazy(() => import('./components/R4JourneyPanel.tsx'))
const R5DevicesPanel = lazy(() => import('./components/R5DevicesPanel.tsx'))

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const STORAGE_KEYS = {
  location: 'airday-place',
}
const CLEAR_FAILURES = { location: false }
function LeafMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 36 36" className="leaf-mark">
      <path d="M28.7 7.3C18.2 7.1 9.3 10.7 8 19c-.8 5.2 3.2 8.5 7.7 7.1 7.5-2.2 11.4-10.1 13-18.8Z" />
      <path d="M8.5 29c4.5-6.3 9.2-10.3 15.8-14" />
    </svg>
  )
}
function App() {
  const [place, setPlace] = useState<Place>(readPlace)
  const placeRef = useRef(place)
  const [changingLocation, setChangingLocation] = useState(
    () => !place.confirmed,
  )
  const local = useLocalRepository()
  const { plan, journal, oneOffs, language } = local.state
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])
  const [offline, setOffline] = useState(!navigator.onLine)
  const [journeysOpen, setJourneysOpen] = useState(false)
  const serviceStatus = useServiceStatus()
  const devicesEnabled =
    serviceStatus.config?.capabilities.r5?.indoorDevices === true
  const journeysEnabled =
    serviceStatus.config?.capabilities.r4?.localJourneys === true
  const groupsEnabled = serviceStatus.config?.capabilities.localGroups === true
  const workspacesEnabled =
    serviceStatus.config?.capabilities.sharedWorkspaces === true
  const [cachedAt, setCachedAt] = useState('')
  const [cacheIssue, setCacheIssue] = useState('')
  const planningDisabled =
    !local.ready || local.busy || local.conflict || offline
  const [templateDraft, setTemplateDraft] = useState<OutdoorPlan | null>(null)
  const [editorMutation, setEditorMutation] = useState(0)
  const t = (en: string, hi: string) => say(language, en, hi)
  const [now, setNow] = useState(Date.now)
  const [requestedDate, setSelectedDate] = useState(
    () => readViewState().date || addDays(dateInIndia(), 1),
  )
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [dashboardError, setDashboardError] = useState('')
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchNotice, setSearchNotice] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [forgetError, setForgetError] = useState('')
  const [editing, setEditing] = useState(false)
  const [failures, setFailures] = useState(CLEAR_FAILURES)
  const [notice, setNotice] = useState('')
  const [undoPlan, setUndoPlan] = useState<OutdoorPlan | null>(null)
  const [actionDraft, setActionDraft] = useState<{
    activity: Activity
    choice: ActivityDecision
    snapshot: DashboardData
    plan: OutdoorPlan
    place: Place
    date: string
    start?: string
    end?: string
    oneOff?: boolean
    newOneOff?: boolean
    mutation: number
  } | null>(null)
  const route = useViewState()
  const highlightedId = route.activityId || null
  const { syncDate } = route
  const motionScope = useAppMotion(route.view)
  const locationReturnView = useRef<AppView>('today')
  const toolTarget = useRef('')
  const dateRef = useRef(requestedDate)
  useEffect(() => {
    if (route.date && route.date !== dateRef.current)
      setSelectedDate(route.date)
  }, [route.date])
  useEffect(() => {
    syncDate(requestedDate)
  }, [requestedDate, syncDate])
  useLayoutEffect(() => {
    if (actionDraft || editing) return
    const target =
      toolTarget.current ||
      (route.view === 'today' && route.activityId
        ? 'activity-' + route.activityId
        : route.view === 'evidence' && route.activityId
          ? 'forecast-title'
          : 'view-title-' + route.view)
    toolTarget.current = ''
    ;(
      document.getElementById(target) ||
      document.getElementById('view-title-' + route.view)
    )?.focus()
  }, [route.view, route.activityId, actionDraft, editing])
  useEffect(() => {
    dateRef.current = requestedDate
  }, [requestedDate])
  const requestId = useRef(0),
    searchId = useRef(0),
    locationId = useRef(0)
  const dashboardAbort = useRef<AbortController | null>(null),
    searchAbort = useRef<AbortController | null>(null)
  const lastAttempt = useRef(0)
  const locationPanel = useRef<HTMLElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
    locationHeading = useRef<HTMLHeadingElement>(null)
  const firstResult = useRef<HTMLButtonElement>(null)

  const refresh = useCallback(async (selected: Place) => {
    dashboardAbort.current?.abort()
    const controller = new AbortController()
    dashboardAbort.current = controller
    const id = ++requestId.current
    lastAttempt.current = Date.now()
    const timeout = window.setTimeout(() => controller.abort('timeout'), 30_000)
    setLoading(true)
    try {
      if (!navigator.onLine)
        throw new Error(
          'You are offline. Cached evidence remains read-only until the connection returns.',
        )
      const params = new URLSearchParams({
        lat: String(selected.latitude),
        lon: String(selected.longitude),
        city: selected.name,
        state: selected.state,
        date:
          dateRef.current >= dateInIndia() &&
          dateRef.current <= addDays(dateInIndia(), 2)
            ? dateRef.current
            : dateInIndia(),
      })
      if (selected.detected) params.set('mode', 'coordinates')
      const response = await fetch(`${API_BASE}/api/dashboard?${params}`, {
        signal: controller.signal,
      })
      const body = await response.json()
      if (!response.ok)
        throw new Error(
          body.error || 'The air-data service could not respond. Please retry.',
        )
      if (id !== requestId.current) return
      if (!validDashboardForPlace(body, selected))
        throw new Error(
          'The data service returned invalid evidence or evidence for a different location. Please retry.',
        )
      setData(body as DashboardData)
      setOffline(false)
      setCachedAt('')
      if (selected.confirmed)
        void saveOfflineEvidence(body)
          .then(() => {
            if (id === requestId.current) setCacheIssue('')
          })
          .catch(
            () =>
              id === requestId.current &&
              setCacheIssue(
                'Offline evidence could not be saved; online data remains available.',
              ),
          )
      setDashboardError('')
      setNow(Date.now())
    } catch (cause) {
      if (
        id !== requestId.current ||
        (controller.signal.aborted && controller.signal.reason !== 'timeout')
      )
        return
      setDashboardError(
        controller.signal.aborted
          ? 'The air-data request took too long. Please retry.'
          : cause instanceof Error
            ? cause.message
            : 'Could not load air data. Please retry.',
      )
      setOffline(true)
      try {
        const cached = await readOfflineEvidence(selected)
        if (id === requestId.current && cached) {
          setData(offlineDashboard(cached.data, selected.confirmed))
          setCachedAt(cached.savedAt)
        }
      } catch {
        if (id === requestId.current)
          setCacheIssue(
            'Offline evidence could not load. Stored bytes were preserved.',
          )
      }
    } finally {
      window.clearTimeout(timeout)
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000)
    const poll = window.setInterval(() => {
      if (!document.hidden && navigator.onLine) void refresh(placeRef.current)
    }, 5 * 60_000)
    const resume = () => {
      if (!document.hidden && navigator.onLine) {
        setNow(Date.now())
        if (Date.now() - lastAttempt.current > 2 * 60_000)
          void refresh(placeRef.current)
      }
    }
    document.addEventListener('visibilitychange', resume)
    const reconnect = () => void refresh(placeRef.current)
    const disconnected = () => {
      setOffline(true)
      requestId.current++
      dashboardAbort.current?.abort()
      setLoading(false)
    }
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', disconnected)
    return () => {
      requestId.current += 1
      dashboardAbort.current?.abort()
      searchAbort.current?.abort()
      window.clearInterval(clock)
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', reconnect)
      window.removeEventListener('offline', disconnected)
    }
  }, [refresh])
  useEffect(() => {
    void refresh(placeRef.current)
  }, [requestedDate, refresh])
  useEffect(() => {
    if (!data?.pending || offline) return
    const retry = window.setTimeout(() => void refresh(placeRef.current), 5000)
    return () => window.clearTimeout(retry)
  }, [data, refresh, offline])

  useEffect(() => {
    if (!matches.length) return
    const dismiss = (event: PointerEvent) => {
      if (!locationPanel.current?.contains(event.target as Node)) setMatches([])
    }
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        locationPanel.current?.contains(event.target as Node)
      ) {
        event.preventDefault()
        setMatches([])
        setSearchNotice('Search results dismissed.')
        searchInput.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [matches.length])

  const today = dateInIndia(now)
  const selectedDate =
    requestedDate >= today && requestedDate <= addDays(today, 2)
      ? requestedDate
      : today

  function persist(key: 'location', value: unknown) {
    const saved = writeStored(STORAGE_KEYS[key], value)
    setFailures((current) => ({ ...current, [key]: !saved }))
    return saved
  }
  function retrySaving() {
    let allSaved = true
    for (const key of Object.keys(failures) as 'location'[])
      if (failures[key]) {
        allSaved = persist(key, place) && allSaved
      }
    setNotice(
      allSaved
        ? 'Your changes are now saved in this browser.'
        : 'Browser saving is still unavailable. Your changes remain in this session.',
    )
  }
  function dismissSearch() {
    setMatches([])
    setSearchNotice('Search results dismissed.')
    searchInput.current?.focus()
  }
  function toggleLocationSearch() {
    if (changingLocation) {
      locationId.current += 1
      searchId.current += 1
      searchAbort.current?.abort()
      setLocating(false)
      setSearching(false)
      setMatches([])
      setSearchNotice('')
      setSearchError('')
      setLocationError('')
    } else {
      requestAnimationFrame(() => searchInput.current?.focus())
    }
    setChangingLocation(!changingLocation)
  }
  async function searchPlaces(event: FormEvent) {
    event.preventDefault()
    if (!query.trim()) {
      setSearchError('Enter a city or town, or choose Use my location.')
      searchInput.current?.focus()
      return
    }
    searchAbort.current?.abort()
    const controller = new AbortController()
    searchAbort.current = controller
    const id = ++searchId.current
    const timeout = window.setTimeout(() => controller.abort('timeout'), 15_000)
    setSearching(true)
    setMatches([])
    setSearchError('')
    setSearchNotice('Searching Indian places…')
    try {
      const response = await fetch(
        `${API_BASE}/api/search?q=${encodeURIComponent(query.trim())}`,
        { signal: controller.signal },
      )
      const body = await response.json()
      if (!response.ok)
        throw new Error(body.error || 'City search failed. Try again.')
      if (id !== searchId.current) return
      if (
        !Array.isArray(body.results) ||
        body.results.length > 10 ||
        !body.results.every(validPlace)
      )
        throw new Error(
          'City search returned invalid location data. Please retry.',
        )
      const results = body.results as Place[]
      setMatches(results || [])
      setSearchNotice(
        results?.length
          ? `${results.length} places found. Tab to the results and choose your place.`
          : '',
      )
      if (!results?.length)
        setSearchError(
          'No matching Indian place was found. Try a nearby city or use device location.',
        )
    } catch (cause) {
      if (
        id !== searchId.current ||
        (controller.signal.aborted && controller.signal.reason !== 'timeout')
      )
        return
      setSearchNotice('')
      setSearchError(
        controller.signal.aborted
          ? 'Search took too long. Press Search to retry.'
          : cause instanceof Error
            ? cause.message
            : 'City search failed. Press Search to retry.',
      )
    } finally {
      window.clearTimeout(timeout)
      if (id === searchId.current) setSearching(false)
    }
  }
  function choosePlace(next: Place) {
    const confirmed = { ...next, confirmed: true }
    setChangingLocation(false)
    locationId.current += 1
    searchId.current += 1
    searchAbort.current?.abort()
    placeRef.current = confirmed
    setPlace(confirmed)
    setData(null)
    setDashboardError('')
    setQuery('')
    setMatches([])
    setSearching(false)
    setLocating(false)
    setSearchError('')
    setSearchNotice('')
    setLocationError('')
    setForgetError('')
    const saved = persist('location', confirmed)
    setNotice(
      `${confirmed.detected ? 'Device location' : confirmed.name} selected. ${saved ? 'Saved in this browser.' : 'Used for this session only.'}`,
    )
    void refresh(confirmed)
    route.navigate(locationReturnView.current, { activityId: '' })
  }
  function useDeviceLocation() {
    setLocationError('')
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocationError(
        'Device location needs HTTPS or localhost and a supported browser. Search for your city instead.',
      )
      return
    }
    const id = ++locationId.current
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (id !== locationId.current) return
        setLocating(false)
        const { latitude, longitude, accuracy } = position.coords
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < 6 ||
          latitude > 38 ||
          longitude < 68 ||
          longitude > 98
        ) {
          setLocationError(
            'The detected position is outside the supported India area. Search for an Indian city instead.',
          )
          return
        }
        if (!Number.isFinite(accuracy) || accuracy > 25_000) {
          setLocationError(
            'The reported device location is too approximate for our nearby-station search. Enable precise location or search for your city.',
          )
          return
        }
        choosePlace({
          name: 'Approximate device location',
          state: '',
          country: 'India',
          latitude,
          longitude,
          detected: true,
          accuracyMeters: accuracy,
          detectedAt: new Date(position.timestamp).toISOString(),
        })
      },
      (failure) => {
        if (id !== locationId.current) return
        setLocating(false)
        setLocationError(
          failure.code === 1
            ? 'Location access was denied. You can allow it in browser settings or search for your city.'
            : failure.code === 3
              ? 'Finding your location took too long. Try again or search for your city.'
              : 'Your device could not find its location. Search for your city instead.',
        )
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    )
  }
  function forgetLocation() {
    if (!removeStored(STORAGE_KEYS.location)) {
      setForgetError(
        'Your browser could not remove the saved location. Clear this site’s storage in browser settings to remove it.',
      )
      return
    }
    locationId.current += 1
    searchId.current += 1
    searchAbort.current?.abort()
    const next = { ...DEFAULT_PLACE }
    setChangingLocation(true)
    placeRef.current = next
    setPlace(next)
    setData(null)
    setLocating(false)
    setSearching(false)
    setMatches([])
    setQuery('')
    setSearchNotice('')
    setSearchError('')
    setLocationError('')
    setForgetError('')
    setFailures((current) => ({ ...current, location: false }))
    setNotice(
      'Saved location removed from this browser. Showing the Delhi preview.',
    )
    void refresh(next)
    requestAnimationFrame(() => searchInput.current?.focus())
  }
  async function savePlan(next: OutdoorPlan) {
    if (editing && editorMutation !== local.mutation) {
      throw new Error(
        'Stored planning data changed. Close the editor, reload and review your draft again.',
      )
    }
    const previous = structuredClone(plan)
    const result = await local.commit({ ...local.state, plan: next })
    if (result === 'conflict') {
      throw new Error(
        'The plan was not saved. Resolve the storage conflict before continuing; your draft is retained.',
      )
    }
    setUndoPlan(previous)
    setTemplateDraft(null)
    setEditing(false)
    setNotice(
      result === 'saved'
        ? 'Plan saved in this browser. Undo is available.'
        : 'Complete plan change kept in this session only. Export before leaving.',
    )
  }
  async function undoSave() {
    if (!undoPlan) return
    const result = await local.commit({ ...local.state, plan: undoPlan })
    if (result !== 'conflict') {
      setUndoPlan(null)
      document.getElementById('view-title-' + route.view)?.focus()
      setNotice(
        result === 'saved'
          ? 'Previous plan restored in this browser.'
          : 'Previous plan restored for this session only.',
      )
    }
  }
  function startAction(
    activity: Activity,
    choice: ActivityDecision,
    start?: string,
    end?: string,
    contextPlan = plan,
    oneOff = false,
    newOneOff = false,
  ) {
    if (planningDisabled) return
    if (!freshPlanningEvidence(data, now)) {
      setNotice(
        t(
          'Refresh a current forecast before recording a decision. Available older evidence remains visible.',
          'निर्णय दर्ज करने से पहले ताज़ा पूर्वानुमान लाएं। उपलब्ध पुराना डेटा दिखता रहेगा।',
        ),
      )
      return
    }
    if (
      !place.confirmed ||
      !contextPlan.configured ||
      !data?.snapshotId ||
      data.policy?.date !== selectedDate ||
      reviewedLocation(data.location).key !== reviewedLocation(place).key
    ) {
      setNotice(
        'Confirm your location and wait for this date’s evidence before recording.',
      )
      return
    }
    setActionDraft({
      activity: structuredClone(activity),
      choice,
      start,
      end,
      snapshot: structuredClone(data),
      plan: structuredClone(contextPlan),
      place: structuredClone(place),
      date: selectedDate,
      oneOff,
      newOneOff,
      mutation: local.mutation,
    })
  }
  async function saveJournal(rows: DecisionRecord[]) {
    return local.commit({ ...local.state, journal: rows })
  }
  async function saveAction(
    reason: string,
    start: string | undefined,
    end: string | undefined,
    at: number,
  ) {
    if (offline)
      throw new Error(
        t(
          'Refresh online before recording. Your draft is retained.',
          'दर्ज करने से पहले ऑनलाइन रिफ्रेश करें। आपका मसौदा सुरक्षित है।',
        ),
      )
    if (!actionDraft?.snapshot.snapshotId)
      throw new Error(
        t(
          'Load an evidence snapshot before recording.',
          'दर्ज करने से पहले डेटा स्नैपशॉट लाएं।',
        ),
      )
    if (
      actionDraft.mutation !== local.mutation ||
      local.conflict ||
      actionDraft.date !== selectedDate ||
      reviewedLocation(actionDraft.place).key !== reviewedLocation(place).key
    )
      throw new Error(
        t(
          'Planning data or location changed. Close this editor and review the latest state before recording.',
          'योजना या स्थान बदल गया। संपादक बंद करके दर्ज करने से पहले वर्तमान स्थिति की समीक्षा करें।',
        ),
      )
    if (actionDraft.newOneOff && oneOffs.length >= 100)
      throw new Error(
        'The 100 quick-activity limit has been reached. Export your data before adding more.',
      )
    const record = createDecisionRecord({
      ...actionDraft,
      reason,
      start,
      end,
      now: at,
    })
    record.kind = actionDraft.oneOff ? 'one_off' : 'scheduled'
    const changedEvidence = decisionSaveReviewReasons(
      record,
      actionDraft.plan,
      data,
      place,
      at,
    )
    if (changedEvidence.length)
      throw new Error(
        t(
          'The evidence changed or is incomplete. Your draft is retained. Close this editor, refresh and review again before recording. ',
          'डेटा बदल गया या अधूरा है। मसौदा सुरक्षित है। संपादक बंद करें, ताज़ा डेटा लाएं और निर्णय से पहले फिर समीक्षा करें। ',
        ) +
          changedEvidence
            .map((reason) => reviewReasonLabel(reason, language))
            .join(' '),
      )
    const nextOneOffs = actionDraft.newOneOff
      ? [
          ...oneOffs,
          {
            id: actionDraft.activity.id,
            date: actionDraft.date,
            locationKey: reviewedLocation(actionDraft.place).key,
            plan: actionDraft.plan,
          },
        ]
      : oneOffs
    const result = await local.commit({
      ...local.state,
      oneOffs: nextOneOffs,
      journal: appendDecision(journal, record),
    })
    if (result === 'conflict')
      throw new Error(
        t(
          'The decision was not saved. Export this session and reload stored data to resolve the conflict; your draft is still here.',
          'निर्णय सहेजा नहीं गया। विरोध सुलझाने के लिए सत्र निर्यात करें और संग्रह दोबारा लोड करें; मसौदा सुरक्षित है।',
        ),
      )
    setNotice(
      result === 'saved'
        ? 'Activity, decision and frozen evidence saved together in this browser.'
        : 'Activity, decision and evidence kept together for this session only. Export before leaving.',
    )
    setActionDraft(null)
  }
  async function reopen(view: ActivityView) {
    if (!view.current) return
    const result = await saveJournal(
      reopenDecision(journal, view.current.id, Date.now()),
    )
    if (result !== 'conflict')
      setNotice(
        result === 'saved'
          ? 'Decision reopened for review. Previous evidence remains in history.'
          : 'Decision reopened for this session only. Export before leaving.',
      )
  }
  function exportJournal() {
    downloadText(
      JSON.stringify(
        { schemaVersion: 2, revision: local.revision, state: local.state },
        null,
        2,
      ),
      'airday-local-planning.json',
      'application/json',
    )
  }
  function focusActivity(id: string) {
    route.navigate('today', { activityId: id })
    requestAnimationFrame(() =>
      document.getElementById('activity-' + id)?.focus(),
    )
  }
  function inspectActivity(id: string) {
    route.navigate('evidence', { activityId: id })
  }
  function openPlace() {
    locationReturnView.current = route.view
    setChangingLocation(true)
    route.navigate('settings')
    requestAnimationFrame(() => searchInput.current?.focus())
  }
  function openQuick() {
    route.navigate('today')
    requestAnimationFrame(() => document.getElementById('quick-title')?.focus())
  }
  function openEditor(next?: OutdoorPlan) {
    setUndoPlan(null)
    setTemplateDraft(next || null)
    setEditorMutation(local.mutation)
    setEditing(true)
  }
  async function exportRecovery() {
    downloadText(
      JSON.stringify(await readStoredRecovery(), null, 2),
      'airday-stored-recovery.json',
      'application/json',
    )
  }
  async function clearLocalData() {
    requestId.current++
    dashboardAbort.current?.abort()
    setLoading(false)
    const emptyState = {
      plan: structuredClone(STARTER_PLAN),
      journal: [],
      oneOffs: [],
      dismissedAlerts: [],
      language: 'en' as const,
      favorites: [],
      feedback: [],
    }
    const result = local.recoveryRequired
      ? await local.recover(emptyState)
      : await local.commit(emptyState)
    if (result !== 'saved')
      throw new Error(
        'Stored deletion could not complete. Original stored data was not cleared; check recovery options.',
      )
    setUndoPlan(null)
    route.navigate('settings', { clearSelection: true })
    const cleanupErrors: string[] = []
    setJourneysOpen(false)
    try {
      const { clearLocalJourneys } = await import('./lib/r4-journey-store.ts')
      await clearLocalJourneys()
    } catch {
      cleanupErrors.push('local journeys')
    }
    try {
      await clearMigrationRecovery()
    } catch {
      cleanupErrors.push('migration recovery')
    }
    try {
      await clearOfflineEvidence()
    } catch {
      cleanupErrors.push('offline evidence')
    }
    const failed = [
      'airday-plan',
      'airday-school-plan',
      'airday-journal',
      'airday-decision-state',
    ].filter((key) => !removeStored(key))
    signOut()
    if (!removeStored(STORAGE_KEYS.location)) failed.push(STORAGE_KEYS.location)
    const next = { ...DEFAULT_PLACE }
    placeRef.current = next
    setPlace(next)
    setData(null)
    setChangingLocation(true)
    setCachedAt('')
    void refresh(next)
    if (failed.length || cleanupErrors.length)
      throw new Error(
        `Planning was cleared, but some storage cleanup did not complete (${[...failed, ...cleanupErrors].join(', ')}). Clear this site's storage in browser settings to finish.`,
      )
    setNotice('Local Airday planning and location cleared.')
  }
  const dayPoints = pointsForDate(data?.forecast?.points || [], selectedDate)
  const activities = activityViews({
    plan,
    oneOffs,
    journal,
    dashboard: data,
    place,
    date: selectedDate,
    now,
  })
  const personal = Boolean(
    place.confirmed && (plan.configured || activities.some((v) => v.oneOff)),
  )
  const { eligible: eligibleJournal } = decisionsForReview(
    journal.filter((r) => r.kind !== 'one_off'),
    selectedDate,
    plan,
    data,
    place,
    now,
  )
  const highlightedView = activities.find((item) => item.id === highlightedId)
  const highlighted = activityForChart(highlightedView)
  const alerts = useReviewAlerts(
    activities,
    selectedDate,
    reviewedLocation(place).key,
    local.state.dismissedAlerts,
    !offline,
  )
  const forecastOld = Boolean(
    data?.forecast &&
    timestampState(data.forecast.fetchedAt, now, FORECAST_MAX_AGE) !== 'fresh',
  )
  const retained = Boolean(
    data?.forecast &&
    (dashboardError ||
      forecastOld ||
      data.sources.forecast?.status === 'unavailable'),
  )
  const forecastRetrieval = data?.sources.forecast
    ? providerPresentation(data.sources.forecast, undefined, now)
    : null
  const coverageCount = dayPoints.filter((row) => row.pm25 !== null).length
  const fullDate = new Intl.DateTimeFormat(
    language === 'hi' ? 'hi-IN' : 'en-IN',
    {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    },
  ).format(new Date(`${selectedDate}T12:00:00+05:30`))
  const peak = (key: 'pm25' | 'pm10') => {
    const values = dayPoints.flatMap((row) =>
      row[key] === null ? [] : [row[key]!],
    )
    return values.length ? Math.max(...values) : null
  }
  const failureKeys = (Object.keys(failures) as 'location'[]).filter(
    (key) => failures[key],
  )
  return (
    <div className="app-shell" ref={motionScope}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        {t('Skip to main content', 'मुख्य सामग्री पर जाएं')}
      </a>
      <header className="topbar">
        <a
          className="brand"
          href="#today"
          onClick={(e) => {
            e.preventDefault()
            route.navigate('today')
          }}
          aria-label="Airday home"
        >
          <LeafMark />
          <span>
            airday<span className="brand-period">.</span>
          </span>
        </a>
        <AppNavigation
          view={route.view}
          language={language}
          disabled={Boolean(actionDraft) || editing}
          onNavigate={(view) => route.navigate(view)}
        />
        <a
          className="text-button"
          href="#settings"
          onClick={(e) => {
            e.preventDefault()
            route.navigate('settings')
            requestAnimationFrame(() =>
              document.getElementById('help-title')?.focus(),
            )
          }}
        >
          {t('Help & settings', 'सहायता और सेटिंग्स')}
        </a>
      </header>
      <ContextBar
        favorites={local.state.favorites}
        onSelectFavorite={(p) => {
          locationReturnView.current = route.view
          choosePlace(p)
        }}
        place={place}
        date={selectedDate}
        now={now}
        language={language}
        loading={loading}
        networkOffline={!navigator.onLine}
        disabled={planningDisabled}
        onPlace={openPlace}
        onDate={(date) => {
          setSelectedDate(date)
          route.navigate(route.view, { date, activityId: '' })
        }}
        onRefresh={() => void refresh(place)}
        onLanguage={(next) =>
          void local.commit({ ...local.state, language: next })
        }
      />
      <main id="main-content" className="main-content" tabIndex={-1}>
        {data?.ingestionWarning && (
          <p role="status" className="coverage-warning">
            {data.ingestionWarning}
          </p>
        )}
        {data?.ingestionPaused && (
          <p role="status" className="coverage-warning">
            Data refresh is paused by the operator. Check the original
            timestamps on available evidence.
          </p>
        )}
        <div className="feedback" role="status">
          <span>{notice}</span>
          {undoPlan && (
            <button
              className="text-button"
              type="button"
              disabled={planningDisabled}
              onClick={undoSave}
            >
              Undo plan save
            </button>
          )}
          {notice && (
            <button
              className="icon-button"
              type="button"
              aria-label="Dismiss update message"
              onClick={() => {
                setNotice('')
                setUndoPlan(null)
                document.getElementById('view-title-' + route.view)?.focus()
              }}
            >
              ×
            </button>
          )}
        </div>
        {failureKeys.length > 0 && (
          <div className="banner warning" role="alert">
            <div>
              <strong>Some changes are saved for this session only.</strong>
              <p>
                Browser storage failed for: {failureKeys.join(', ')}. Closing
                this page may lose those changes.
              </p>
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={retrySaving}
            >
              Retry saving
            </button>
          </div>
        )}
        {dashboardError && (
          <div className="banner warning" role="alert">
            <div>
              <strong>
                {data
                  ? 'Refresh failed · last available evidence shown'
                  : 'Air data could not load'}
              </strong>
              <p>{dashboardError}</p>
            </div>
            <button
              className="button secondary"
              type="button"
              disabled={loading || !navigator.onLine}
              onClick={() => void refresh(place)}
            >
              Retry data
            </button>
          </div>
        )}

        {offline && (
          <div className="banner warning" role="status">
            <strong>
              {t(
                'Offline / unavailable service · read-only evidence',
                'ऑफलाइन / सेवा अनुपलब्ध · केवल पढ़ने का डेटा',
              )}
            </strong>
            <p>
              {t(
                'No current network verification. Retained values keep their original retrieval and observation times. Decisions and alerts need an online refresh before use.',
                'वर्तमान नेटवर्क सत्यापन नहीं। डेटा के मूल प्राप्ति और मापन समय रहते हैं। निर्णय और चेतावनी से पहले ऑनलाइन रिफ्रेश करें।',
              )}{' '}
              {cachedAt &&
                `${t('Cache saved', 'संग्रह समय')}: ${formatTimestamp(cachedAt, now)}`}
              {cachedAt &&
                t(
                  ' Cached station distances refer to the rounded area, not your exact detected position.',
                  ' संग्रहीत स्टेशन दूरी गोल क्षेत्र से है, आपके सटीक स्थान से नहीं।',
                )}
            </p>
          </div>
        )}
        {cacheIssue && (
          <p role="status" className="help-text">
            {cacheIssue}
          </p>
        )}
        {local.issue && (
          <div className="banner warning" role="alert">
            {local.issue}{' '}
            <button
              type="button"
              className="text-button"
              onClick={() => route.navigate('settings')}
            >
              {t('Storage recovery options', 'संग्रह रिकवरी विकल्प')}
            </button>
          </div>
        )}
        <section
          className="view-panel"
          data-view="today"
          hidden={route.view !== 'today'}
          aria-labelledby="view-title-today"
        >
          <FeatureShowcase
            language={language}
            disabled={Boolean(actionDraft || editing)}
            capabilities={serviceStatus.config?.capabilities || null}
            onFind={openQuick}
            onOpen={(view, target) => {
              if (view === route.view) {
                const element = document.getElementById(target)
                element?.setAttribute('tabindex', '-1')
                element?.focus({ preventScroll: true })
                element?.scrollIntoView({
                  block: 'start',
                  behavior: window.matchMedia(
                    '(prefers-reduced-motion: reduce)',
                  ).matches
                    ? 'instant'
                    : 'smooth',
                })
              } else {
                toolTarget.current = target
                route.navigate(view)
              }
            }}
          />
          <div className="view-heading today-heading day-heading">
            <h2>{t('Your day, at a glance.', 'आपका दिन, एक नज़र में।')}</h2>
            <p className="view-dateline">
              {fullDate}{' '}
              <span>
                {place.confirmed
                  ? place.name
                  : t('Delhi preview', 'दिल्ली पूर्वावलोकन')}
              </span>
            </p>
          </div>
          <div className="day-overview">
            <NextActionCard
              views={activities}
              place={place}
              date={selectedDate}
              data={data}
              now={now}
              language={language}
              onPlace={openPlace}
              onFind={openQuick}
              onReview={focusActivity}
              onEvidence={() => route.navigate('evidence')}
            />
            <DayAirPreview
              points={dayPoints}
              language={language}
              loading={loading}
              retained={Boolean(
                data?.forecast &&
                timestampState(
                  data.forecast.fetchedAt,
                  now,
                  FORECAST_MAX_AGE,
                ) !== 'fresh',
              )}
              onEvidence={() => route.navigate('evidence')}
            />
          </div>
          <ToolDrawer
            language={language}
            disabled={Boolean(actionDraft || editing)}
            onOpen={(view, target) => {
              toolTarget.current = target
              route.navigate(view)
            }}
          />
          <SetupStepper
            confirmed={Boolean(place.confirmed)}
            hasActivity={plan.configured || oneOffs.length > 0}
            language={language}
            onPlace={openPlace}
            onQuick={openQuick}
            onTemplate={() => route.navigate('plan')}
          />
          <div className="today-workspace">
            {local.ready && (
              <QuickTimeFinder
                key={reviewedLocation(place).key + selectedDate}
                data={data}
                date={selectedDate}
                now={now}
                confirmed={Boolean(place.confirmed)}
                threshold={plan.threshold}
                language={language}
                disabled={planningDisabled}
                onChoose={(a, p) =>
                  startAction(
                    a,
                    'outdoors',
                    undefined,
                    undefined,
                    p,
                    true,
                    true,
                  )
                }
              />
            )}
            <ReviewAlertList
              alerts={alerts}
              language={language}
              disabled={planningDisabled}
              onReview={focusActivity}
              onDismiss={(id) =>
                void local.commit({
                  ...local.state,
                  dismissedAlerts: [...local.state.dismissedAlerts, id].slice(
                    -200,
                  ),
                })
              }
            />
          </div>
          <section
            className="card plan-card"
            id="outdoor-plan"
            aria-labelledby="outdoor-title"
          >
            <div className="section-heading">
              <div>
                <h2 id="outdoor-title">
                  {t('Your activity timeline', 'आपकी गतिविधियों की समयरेखा')}
                </h2>
                <p className="section-meta">
                  {!local.ready
                    ? t(
                        'Plan · loading storage',
                        'योजना · संग्रह लोड हो रहा है',
                      )
                    : !plan.configured
                      ? t('Example schedule', 'उदाहरण समय-सारणी')
                      : local.sessionOnly
                        ? t('Plan · session only', 'योजना · केवल इस सत्र में')
                        : t(
                            'Plan · saved in this browser',
                            'योजना · इस ब्राउज़र में सहेजी',
                          )}
                </p>
              </div>
              <button
                className="button secondary"
                type="button"
                disabled={planningDisabled}
                onClick={() => route.navigate('plan')}
              >
                {t('Manage recurring plan', 'नियमित योजना प्रबंधित करें')}
              </button>
            </div>
            <p className="section-subtitle">
              {fullDate} · {t('all times in IST', 'सभी समय IST में')}
            </p>
            {!personal && (
              <p className="preview-note">
                {!plan.configured
                  ? t(
                      'These activities are a starter example. Confirm your location and save your own plan to receive personal review prompts.',
                      'ये गतिविधियां शुरुआती उदाहरण हैं। व्यक्तिगत समीक्षा संदेश के लिए स्थान की पुष्टि करें और अपनी योजना सहेजें।',
                    )
                  : t(
                      'Confirm a location above to evaluate your plan.',
                      'योजना की तुलना के लिए ऊपर स्थान की पुष्टि करें।',
                    )}
              </p>
            )}
            <ActivityTimeline
              feedback={local.state.feedback}
              locationKey={reviewedLocation(place).key}
              onFeedback={async (feedback) => {
                return local.commit({
                  ...local.state,
                  feedback: appendSuggestionFeedback(
                    local.state.feedback,
                    feedback,
                  ),
                })
              }}
              date={selectedDate}
              now={now}
              data={data}
              onHistory={(id) => route.navigate('history', { recordId: id })}
              views={activities}
              language={language}
              disabled={planningDisabled}
              onInspect={inspectActivity}
              onAction={(v, c, a, b) =>
                startAction(v, c, a, b, v.contextPlan, v.oneOff)
              }
              onReopen={(v) => void reopen(v)}
              onFollowThrough={(id, value) =>
                void saveJournal(
                  journal.map((row) =>
                    row.id === id ? { ...row, followThrough: value } : row,
                  ),
                )
              }
            />
            <details className="rule-help">
              <summary>
                {t(
                  'How your review rule works',
                  'आपकी समीक्षा सीमा कैसे काम करती है',
                )}
              </summary>
              <p>
                {plan.ruleMode === 'example'
                  ? t('Example setting', 'उदाहरण सीमा')
                  : t('Custom threshold', 'आपकी चुनी सीमा')}
                : <strong>{concentration(plan.threshold)} µg/m³ PM2.5.</strong>{' '}
                {t(
                  'An activity is flagged when any available hourly PM2.5 forecast in its time window is above that number. For example, 80 with a rule of 75 means review the plan.',
                  'गतिविधि के समय का कोई उपलब्ध प्रति घंटा PM2.5 पूर्वानुमान सीमा से ऊपर हो तो समीक्षा का संकेत मिलता है। उदाहरण: 75 की सीमा पर 80 का पूर्वानुमान योजना की समीक्षा बताता है।',
                )}
              </p>
              <p>
                {t(
                  'PM2.5 is fine particulate matter. The example setting is illustrative and is not a recommended health limit. CAMS Global has a roughly 45 km grid and 3-hour source resolution, so time-window comparisons are approximate. This rule is not an official Indian AQI category. Below the rule does not establish safety.',
                  'PM2.5 हवा के महीन कण हैं। उदाहरण सीमा स्वास्थ्य सीमा की सिफारिश नहीं है। CAMS Global लगभग 45 km ग्रिड और 3 घंटे के स्रोत चरण उपयोग करता है, इसलिए समय की तुलना अनुमानित है। यह आधिकारिक भारतीय AQI श्रेणी नहीं है। सीमा से नीचे होना सुरक्षा का प्रमाण नहीं है।',
                )}
              </p>
            </details>
            <p className="help-text">
              {t(
                'You make the decision. Check current local advisories. Your plan and decisions are kept in this browser; they are not shared across devices.',
                'निर्णय आपका है। वर्तमान स्थानीय निर्देश देखें। योजना और निर्णय इसी ब्राउज़र में रहते हैं; दूसरे डिवाइस पर साझा नहीं होते।',
              )}
            </p>
            <div className="button-row">
              <button
                type="button"
                className="button secondary"
                disabled={!journal.length}
                onClick={exportJournal}
              >
                {t(
                  'Export plan and decision history',
                  'योजना और निर्णय इतिहास निर्यात करें',
                )}
              </button>
              <span className="help-text">
                {
                  journal.filter((row) => row.followThrough === 'completed')
                    .length
                }{' '}
                {t(
                  'actions followed · last 200 local records retained',
                  'निर्णय पालन किए · अंतिम 200 स्थानीय रिकॉर्ड रखे जाते हैं',
                )}
              </span>
            </div>
          </section>

          <GuidanceCard
            views={activities}
            language={language}
            forecastFresh={Boolean(data?.forecast && !forecastOld)}
          />
        </section>
        <section
          className="view-panel"
          data-view="plan"
          hidden={route.view !== 'plan'}
          aria-labelledby="view-title-plan"
        >
          <div className="view-heading">
            <h1 id="view-title-plan" tabIndex={-1}>
              {t('Activities & constraints', 'गतिविधियां और सीमाएं')}
            </h1>
            <p>
              {t(
                'Start small, then add recurrence and practical alternatives.',
                'छोटी शुरुआत करें, फिर नियमित दिन और व्यावहारिक विकल्प जोड़ें।',
              )}
            </p>
          </div>
          <PlanOverview
            plan={plan}
            language={language}
            disabled={planningDisabled}
            sessionOnly={local.sessionOnly}
            onEdit={() => openEditor()}
            onTemplate={openEditor}
            onQuick={openQuick}
          />
        </section>
        <section
          className="view-panel"
          data-view="evidence"
          hidden={route.view !== 'evidence'}
          aria-labelledby="view-title-evidence"
        >
          <div className="view-heading">
            <h1 id="view-title-evidence" tabIndex={-1}>
              {t('Understand the air evidence', 'वायु डेटा को समझें')}
            </h1>
            <p>
              {t(
                'Regional model forecasts and independent station observations stay separate.',
                'क्षेत्रीय मॉडल पूर्वानुमान और स्टेशन के अवलोकन अलग रहते हैं।',
              )}
            </p>
          </div>
          <EvidenceStatus
            data={data}
            now={now}
            language={language}
            loading={loading}
            error={dashboardError}
          />
          <div className="evidence-column" id="evidence">
            {data?.coverage && (
              <section
                className="card coverage-panel"
                aria-labelledby="coverage-title"
              >
                <div className="section-heading">
                  <h2 id="coverage-title">Evidence available for this area</h2>
                  <span className="badge neutral">
                    {coverageState(data, now).replaceAll('_', ' ')}
                  </span>
                </div>
                <p>
                  {data.coverage.returnedStationCount} returned usable stations
                  within {data.coverage.searchRadiusKm} km
                  {data.coverage.nearestDistanceKm !== null
                    ? ` · nearest ${data.coverage.nearestDistanceKm.toFixed(1)} km`
                    : ''}
                  .
                </p>
                <p className="help-text">{data.coverage.message}</p>
                {data.ingestionPaused && (
                  <p className="coverage-warning">
                    Refresh ingestion is paused. Existing evidence keeps its
                    original timestamp.
                  </p>
                )}
              </section>
            )}
            {data?.policy && (
              <details className="card policy-panel">
                <summary>
                  Official guidance ·{' '}
                  {data.policy.date === selectedDate &&
                  data.policy.status === 'reviewed_guidance'
                    ? 'reviewed document available'
                    : 'verification needed'}
                </summary>
                <p>
                  {data.policy.date === selectedDate
                    ? data.policy.message
                    : 'Checking guidance for the selected date. Confirm current directions with the issuing authority.'}
                </p>
                <p className="help-text">
                  Your PM2.5 rule does not activate GRAP or authorize an
                  activity covered by an order.
                </p>
                {(data.policy.date === selectedDate
                  ? data.policy.records
                  : []
                ).map((record) => (
                  <p key={record.id}>
                    <a href={record.url} target="_blank" rel="noreferrer">
                      {record.title}
                    </a>
                    {record.instruction && <span> · {record.instruction}</span>}
                  </p>
                ))}
                <div className="button-row">
                  {data.policy.sources.map((source) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.name} ↗
                    </a>
                  ))}
                </div>
              </details>
            )}

            <section
              className="card forecast-card"
              aria-labelledby="forecast-title"
            >
              <div className="section-heading">
                <div>
                  <h2 id="forecast-title" tabIndex={-1}>
                    {highlighted
                      ? `Forecast for ${highlighted.activity}`
                      : 'The air outlook'}
                  </h2>
                  <p className="section-meta">Regional model forecast</p>
                </div>
                <span className={`badge ${retained ? 'warning' : 'neutral'}`}>
                  {!data?.forecast
                    ? loading
                      ? 'Loading'
                      : 'Unavailable'
                    : retained
                      ? 'Last available'
                      : 'Retrieved forecast'}
                </span>
              </div>
              <p className="section-subtitle">
                {fullDate} · µg/m³ · full day in IST
              </p>
              {data?.forecast ? (
                <>
                  {forecastRetrieval?.failed && (
                    <p className="coverage-warning">
                      <strong>{forecastRetrieval.retrievalLabel}.</strong>{' '}
                      {forecastRetrieval.message} Last successful retrieval:{' '}
                      {formatTimestamp(forecastRetrieval.lastSuccessAt, now)}.
                      Latest attempt:{' '}
                      {formatTimestamp(forecastRetrieval.lastAttemptAt, now)}.
                      The forecast below keeps its original retrieval time.
                    </p>
                  )}
                  <p className="freshness">
                    <strong>Forecast retrieved:</strong>{' '}
                    {formatTimestamp(data.forecast.fetchedAt, now)}
                  </p>
                  <p className="model-note">
                    CAMS Global · approximately 45 km grid · 3-hour source
                    resolution. Hourly display values are regional model output,
                    not readings at your exact location.
                  </p>
                  <div className="forecast-peaks">
                    <div>
                      <span>PM2.5 forecast peak</span>
                      <strong>
                        {concentration(peak('pm25'))} <small>µg/m³</small>
                      </strong>
                    </div>
                    <div>
                      <span>PM10 forecast peak</span>
                      <strong>
                        {concentration(peak('pm10'))} <small>µg/m³</small>
                      </strong>
                    </div>
                  </div>
                  {coverageCount < 24 && (
                    <p className="coverage-warning" role="status">
                      PM2.5 available for {coverageCount} of 24 hours. Gaps are
                      missing data.
                    </p>
                  )}
                  {highlighted && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        route.navigate('evidence', { activityId: '' })
                      }
                    >
                      Clear activity highlight
                    </button>
                  )}
                  <ForecastChart
                    key={selectedDate + (highlightedId || '')}
                    points={dayPoints}
                    language={language}
                    threshold={
                      highlightedView
                        ? highlightedView.contextPlan.configured
                          ? highlightedView.contextPlan.threshold
                          : null
                        : personal
                          ? plan.threshold
                          : null
                    }
                    activity={highlighted}
                    originalWindow={highlightedView?.current?.originalWindow}
                  />
                  <p className="help-text">
                    <a
                      href="https://open-meteo.com/en/docs/air-quality-api"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Forecast source: Open-Meteo / CAMS Global
                    </a>{' '}
                    · concentrations, not official Indian AQI.
                  </p>
                </>
              ) : (
                <div className="empty-message" role="status">
                  {loading
                    ? 'Loading the regional forecast. Your saved plan remains available.'
                    : data?.sources.forecast?.message ||
                      'No forecast loaded. Use Refresh data to retry.'}
                </div>
              )}
            </section>

            <StationExplorer
              active={route.view === 'evidence' && !offline}
              data={data}
              now={now}
              language={language}
              loading={loading}
            />
            <PollutantExplorer
              data={data}
              date={selectedDate}
              language={language}
              now={now}
            />
            <ContextPanels
              key={`${place.latitude},${place.longitude}#${selectedDate}`}
              place={place}
              date={selectedDate}
              language={language}
              active={route.view === 'evidence' && !offline}
              cap={serviceStatus.config?.capabilities || null}
              configurationError={
                serviceStatus.loading ? '' : serviceStatus.error
              }
              onRetryConfiguration={serviceStatus.retry}
            />
          </div>
        </section>
        <section
          className="view-panel"
          data-view="history"
          hidden={route.view !== 'history'}
          aria-labelledby="view-title-history"
        >
          <div className="view-heading">
            <h1 id="view-title-history" tabIndex={-1}>
              {t('Decisions & reports', 'निर्णय और रिपोर्ट')}
            </h1>
            <p>
              {t(
                'Read what was recorded, including the settings and evidence at that time.',
                'उस समय की सीमा और डेटा के साथ दर्ज निर्णय पढ़ें।',
              )}
            </p>
          </div>
          {local.ready && (
            <HistoryView
              active={route.view === 'history'}
              key={route.recordId || 'all-history'}
              initialRecordId={route.recordId}
              onClearScope={() =>
                route.navigate('history', { clearSelection: true })
              }
              journal={journal}
              language={language}
              sessionOnly={local.sessionOnly}
              disabled={planningDisabled}
              onFollowThrough={async (id, value) => {
                const record = journal.find((row) => row.id === id)
                if (
                  planningDisabled ||
                  !record ||
                  record.choice === 'pending' ||
                  ['reopened', 'superseded'].includes(record.lifecycle || '')
                )
                  return
                await saveJournal(
                  journal.map((row) =>
                    row.id === id ? { ...row, followThrough: value } : row,
                  ),
                )
              }}
            />
          )}
          {local.ready && (
            <PersonalProgress
              state={local.state}
              place={place}
              language={language}
              disabled={!local.ready || local.busy || local.conflict}
              onCommit={local.commit}
            />
          )}
          {data && (
            <HistoryTrends
              key={reviewedLocation(place).key}
              data={data}
              language={language}
              active={route.view === 'history' && !offline}
              now={now}
            />
          )}
          <div className="button-row" hidden={!journeysEnabled}>
            <button
              type="button"
              className="button secondary"
              aria-expanded={journeysOpen}
              aria-controls="local-journeys"
              onClick={() => setJourneysOpen((open) => !open)}
            >
              {t(
                journeysOpen ? 'Close local journeys' : 'Open local journeys',
                journeysOpen
                  ? 'स्थानीय यात्राएं बंद करें'
                  : 'स्थानीय यात्राएं खोलें',
              )}
            </button>
          </div>
          <div id="local-journeys">
            {journeysEnabled && journeysOpen && route.view === 'history' && (
              <Suspense
                fallback={
                  <p role="status">
                    {t(
                      'Loading local journeys…',
                      'स्थानीय यात्राएं लोड हो रही हैं…',
                    )}
                  </p>
                }
              >
                <R4JourneyPanel language={language} />
              </Suspense>
            )}
          </div>
        </section>
        <section
          className="view-panel"
          data-view="settings"
          hidden={route.view !== 'settings'}
          aria-labelledby="view-title-settings"
        >
          <div className="view-heading">
            <h1 id="view-title-settings" tabIndex={-1}>
              {t('Your location, data & help', 'आपका स्थान, डेटा और सहायता')}
            </h1>
            <p>
              {t(
                'Local planning works without signing in.',
                'स्थानीय योजना बिना लॉग-इन के काम करती है।',
              )}
            </p>
          </div>
          <SettingsDirectory language={language} />
          <div className="settings-workspace">
            {local.ready && (
              <FavoritePlaces
                places={local.state.favorites}
                place={place}
                data={data}
                language={language}
                disabled={!local.ready || local.busy || local.conflict}
                onSave={(favorites) =>
                  local.commit({
                    ...local.state,
                    favorites,
                    groups: (local.state.groups || [])
                      .map((g) => ({
                        ...g,
                        placeIds: g.placeIds.filter((id) =>
                          favorites.some((f) => f.id === id),
                        ),
                      }))
                      .filter((g) => g.placeIds.length),
                  })
                }
                onSelect={(p) => {
                  locationReturnView.current = route.view
                  choosePlace(p)
                }}
              />
            )}
            <section
              id="settings"
              className="card local-settings"
              aria-labelledby="settings-title"
            >
              <div className="section-heading">
                <h2 id="settings-title" tabIndex={-1}>
                  {t('Local settings', 'स्थानीय सेटिंग्स')}
                </h2>
                <span className="badge neutral">
                  {!local.ready
                    ? t('Loading storage…', 'संग्रह लोड हो रहा है…')
                    : local.sessionOnly
                      ? t('Session only', 'केवल इस सत्र में')
                      : t('Saved in this browser', 'इस ब्राउज़र में सहेजा')}
                </span>
              </div>
              <label>
                {t('Planning tools language', 'योजना उपकरण की भाषा')}
                <select
                  value={language}
                  disabled={planningDisabled}
                  onChange={(e) =>
                    void local.commit({
                      ...local.state,
                      language: e.target.value as 'en' | 'hi',
                    })
                  }
                >
                  <option value="en">English</option>
                  <option value="hi">हिन्दी</option>
                </select>
              </label>
              <p className="help-text">
                {t(
                  'Timeline, finder, guidance and reports support both languages. Provider details and advanced editors remain in English. Reports omit private names and reasons unless you include them. Local backups include your complete planning records and remain private files.',
                  'समयरेखा, खोज, मार्गदर्शन और रिपोर्ट दोनों भाषाओं में हैं। स्रोत विवरण और उन्नत संपादक अंग्रेज़ी में हैं। रिपोर्ट में निजी नाम और कारण आपकी अनुमति से जुड़ते हैं। स्थानीय बैकअप में पूरा योजना रिकॉर्ड होता है; इसे निजी रखें।',
                )}
              </p>
              {local.issue && <p className="coverage-warning">{local.issue}</p>}
              <div className="button-row">
                <button
                  type="button"
                  className="button secondary"
                  onClick={exportJournal}
                >
                  Export local data
                </button>
                {local.issue && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={local.busy || Boolean(actionDraft) || editing}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Reload stored planning data? Unsaved session changes will be replaced. Export them first.',
                        )
                      ) {
                        setUndoPlan(null)
                        void local.reload()
                      }
                    }}
                  >
                    Reload stored data
                  </button>
                )}
                {local.sessionOnly &&
                  !local.conflict &&
                  !local.recoveryRequired && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={planningDisabled}
                      onClick={() => void local.commit(local.state)}
                    >
                      Retry complete save
                    </button>
                  )}
              </div>
              <LocalDataControls
                state={local.state}
                language={language}
                disabled={planningDisabled}
                mutation={local.mutation}
                recoveryRequired={local.recoveryRequired}
                onCommit={local.commit}
                onRecover={local.recover}
                onExport={exportJournal}
              />
            </section>
            <ServiceStatus status={serviceStatus} language={language} />
            <OfflineControls language={language} disabled={local.busy} />
            <section
              className="card location-panel"
              aria-labelledby="location-title"
              ref={locationPanel}
            >
              <div className="location-current">
                <div>
                  <h2 id="location-title" ref={locationHeading} tabIndex={-1}>
                    {place.name}
                    {place.state ? `, ${place.state}` : ''}
                  </h2>
                  <p className="section-meta">
                    {!place.confirmed ? 'Delhi preview' : 'Selected location'}
                  </p>
                  <p>
                    {place.detected
                      ? 'City name is unknown. Change the location if this position is wrong.'
                      : !place.confirmed
                        ? 'Choose your place or use Delhi for your plan.'
                        : failures.location
                          ? 'Location selected for this session only.'
                          : 'Selected place saved in this browser.'}
                  </p>
                </div>
                {place.confirmed && (
                  <div className="button-row">
                    <button
                      className="text-button"
                      type="button"
                      aria-expanded={changingLocation}
                      aria-controls="location-controls"
                      onClick={toggleLocationSearch}
                    >
                      {changingLocation
                        ? 'Close location search'
                        : 'Change place'}
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={forgetLocation}
                    >
                      Forget saved location
                    </button>
                  </div>
                )}
              </div>
              <div
                id="location-controls"
                hidden={place.confirmed && !changingLocation}
              >
                <form className="location-search" onSubmit={searchPlaces}>
                  <label htmlFor="city-search">City or town in India</label>
                  <div className="search-controls">
                    <input
                      id="city-search"
                      ref={searchInput}
                      maxLength={80}
                      value={query}
                      placeholder="e.g. Delhi, Pune, Lucknow"
                      aria-invalid={Boolean(searchError)}
                      aria-describedby={`location-use search-status${searchError ? ' search-error' : ''}`}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown' && matches.length) {
                          event.preventDefault()
                          firstResult.current?.focus()
                        }
                      }}
                    />
                    <button
                      className="button primary"
                      type="submit"
                      disabled={searching}
                    >
                      {searching ? 'Searching…' : 'Search'}
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={useDeviceLocation}
                      disabled={locating}
                    >
                      {locating ? 'Finding location…' : '⌖ Use my location'}
                    </button>
                  </div>
                  <p id="location-use" className="help-text">
                    Device location asks for your permission. Coordinates are
                    sent to our API for this lookup and saved in this browser.
                    Use Forget saved location to remove them. We do not
                    continuously track your position. Refresh jobs and provider
                    requests use a rounded area rather than your exact device
                    coordinates.
                  </p>
                  <p id="search-status" className="search-status" role="status">
                    {searchNotice}
                  </p>
                  {searchError && (
                    <p id="search-error" className="field-error" role="alert">
                      {searchError}
                    </p>
                  )}
                  {matches.length > 0 && (
                    <div className="search-results">
                      <div className="section-heading">
                        <strong>Choose a place</strong>
                        <button
                          className="text-button"
                          type="button"
                          onClick={dismissSearch}
                        >
                          Dismiss results
                        </button>
                      </div>
                      <ul aria-label="Matching Indian places">
                        {matches.map((match, index) => (
                          <li
                            key={`${match.name}-${match.latitude}-${match.longitude}`}
                          >
                            <button
                              className="result-button"
                              type="button"
                              ref={index === 0 ? firstResult : undefined}
                              onClick={() => choosePlace(match)}
                            >
                              <strong>{match.name}</strong>
                              <span>
                                {match.state}, {match.country}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </form>
                {locating && (
                  <div className="inline-actions" role="status">
                    <span>
                      Waiting for device location. Allow the browser prompt if
                      you want to continue.
                    </span>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        locationId.current += 1
                        setLocating(false)
                        setNotice('Location request cancelled in Airday.')
                      }}
                    >
                      Cancel locating
                    </button>
                  </div>
                )}
                {locationError && (
                  <p className="field-error" role="alert">
                    {locationError}
                  </p>
                )}
              </div>
              {forgetError && (
                <p className="field-error" role="alert">
                  {forgetError}
                </p>
              )}
              <details className="location-details">
                <summary>Location details and accuracy</summary>
                <p>
                  {place.latitude.toFixed(3)}° N, {place.longitude.toFixed(3)}°
                  E
                </p>
                {place.detected && (
                  <>
                    <p>
                      Device location accuracy: approximately ±
                      {place.accuracyMeters && place.accuracyMeters >= 1000
                        ? `${(place.accuracyMeters / 1000).toFixed(1)} km`
                        : `${Math.round(place.accuracyMeters || 0)} m`}
                      . Captured {formatTimestamp(place.detectedAt, now)}.
                    </p>
                    <p>
                      Use my location again to update this saved position. GPS
                      accuracy does not change the roughly 45 km forecast grid.
                    </p>
                    <p>
                      Monitor searches use coordinates. Availability depends on
                      provider coverage and verified measurement metadata.
                    </p>
                  </>
                )}
              </details>
            </section>

            <PrivacyControls
              journeysEnabled={journeysEnabled}
              language={language}
              disabled={planningDisabled}
              onExport={exportJournal}
              onClear={clearLocalData}
              onRecoveryExport={exportRecovery}
            />
            <HelpPanel language={language} data={data} />
            {workspacesEnabled && (
              <WorkspacePanel
                plan={plan}
                journal={
                  offline
                    ? []
                    : [
                        ...eligibleJournal,
                        ...activities
                          .filter(
                            (v) => v.oneOff && v.current && !v.reasons.length,
                          )
                          .flatMap((v) => (v.current ? [v.current] : [])),
                      ]
                }
                oneOffs={oneOffs}
                place={place}
                onSelectPlace={(p) => {
                  locationReturnView.current = route.view
                  choosePlace(p)
                }}
                onLoad={savePlan}
              />
            )}
            {groupsEnabled && local.ready && (
              <LocalGroups
                state={local.state}
                disabled={planningDisabled}
                onCommit={local.commit}
                onSelect={(p) => {
                  locationReturnView.current = route.view
                  choosePlace(p)
                }}
              />
            )}
            <PublicTools
              place={place}
              enabled={
                serviceStatus.config?.capabilities.publicEvidence === true
              }
            />
            {devicesEnabled && route.view === 'settings' && (
              <Suspense fallback={null}>
                <R5DevicesPanel enabled language={language} active={!offline} />
              </Suspense>
            )}
          </div>
        </section>
        <footer className="page-footer">
          <div className="footer-top">
            <div className="footer-about">
              <LeafMark />
              <h2>
                {t(
                  'A little clarity for your everyday.',
                  'आपके हर दिन के लिए थोड़ी स्पष्टता।',
                )}
              </h2>
              <p>
                {t(
                  'Outdoor planning for India. Built around your activities, with the evidence and its limits in view.',
                  'भारत में बाहरी गतिविधियों की योजना। आपकी गतिविधियाँ, उपलब्ध डेटा और उसकी सीमाएँ एक साथ।',
                )}
              </p>
            </div>
            <nav aria-label={t('Footer navigation', 'फुटर नेविगेशन')}>
              <h3>{t('Your day', 'आपका दिन')}</h3>
              {(
                [
                  'today',
                  'plan',
                  'evidence',
                  'history',
                  'settings',
                ] as AppView[]
              ).map((view, index) => (
                <button
                  type="button"
                  className="text-button"
                  key={view}
                  disabled={Boolean(actionDraft || editing)}
                  onClick={() => route.navigate(view)}
                >
                  {t(
                    ['Today', 'Plan', 'Evidence', 'History', 'Settings'][index],
                    ['आज', 'योजना', 'डेटा', 'इतिहास', 'सेटिंग्स'][index],
                  )}
                </button>
              ))}
            </nav>
            <div className="footer-method">
              <h3>
                {t('Made for real decisions', 'वास्तविक निर्णयों के लिए')}
              </h3>
              <p>
                {t(
                  'Regional forecasts. Independent observations. Your choice.',
                  'क्षेत्रीय पूर्वानुमान। स्वतंत्र अवलोकन। आपका निर्णय।',
                )}
              </p>
              <a
                href="https://www.geonames.org/"
                target="_blank"
                rel="noreferrer"
              >
                Place names: GeoNames via Open-Meteo
              </a>
            </div>
          </div>
          <div className="footer-wordmark" aria-hidden="true">
            airday.
          </div>
          <div className="footer-bottom">
            <span>Airday · outdoor planning for India</span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                document.getElementById(`view-title-${route.view}`)?.focus()
                window.scrollTo({
                  top: 0,
                  behavior: window.matchMedia(
                    '(prefers-reduced-motion: reduce)',
                  ).matches
                    ? 'instant'
                    : 'smooth',
                })
              }}
            >
              {t('Back to top ↑', 'ऊपर वापस जाएं ↑')}
            </button>
          </div>
        </footer>
      </main>
      {editing && (
        <PlanEditor
          plan={templateDraft || plan}
          language={language}
          onSave={savePlan}
          onClose={() => {
            setEditing(false)
            setTemplateDraft(null)
          }}
        />
      )}
      {actionDraft && (
        <DecisionEditor
          activity={actionDraft.activity}
          date={actionDraft.date}
          language={language}
          points={actionDraft.snapshot.forecast?.points || []}
          threshold={actionDraft.plan.threshold}
          fetchedAt={actionDraft.snapshot.forecast?.fetchedAt}
          now={now}
          choice={actionDraft.choice}
          proposedStart={actionDraft.start}
          proposedEnd={actionDraft.end}
          evidenceLabel={`Evidence ${actionDraft.snapshot.snapshotId} · forecast retrieved ${formatTimestamp(actionDraft.snapshot.forecast?.fetchedAt, now)}. This record keeps the evidence shown when you opened the editor.`}
          onClose={() => setActionDraft(null)}
          onSave={(reason, start, end) =>
            saveAction(reason, start, end, Date.now())
          }
        />
      )}
    </div>
  )
}
export default App
