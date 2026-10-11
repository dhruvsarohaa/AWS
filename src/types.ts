export type Place = {
  name: string
  state: string
  country: string
  latitude: number
  longitude: number
  timezone?: string
  detected?: boolean
  accuracyMeters?: number
  detectedAt?: string
  confirmed?: boolean
}
export type ForecastPoint = {
  time: string
  pm25: number | null
  pm10: number | null
}
export type Pollutant = 'pm25' | 'pm10' | 'no2' | 'o3' | 'so2' | 'co'
export type PollutantSeries = {
  schemaVersion: 1
  unit: 'µg/m³'
  source: string
  statistic: 'model_sample'
  stepMinutes: 60
  values: { time: string; value: number | null }[]
}
export type FavoritePlace = { id: string; label: string; place: Place }
export type SuggestionFeedback = {
  id: string
  assessmentId: string
  decisionId?: string
  locationKey: string
  date: string
  activity: string
  at: string
  useful: boolean
  reason: 'timing' | 'indoor_option' | 'data' | 'clear' | 'other'
  note: string
}
export type Monitor = {
  source: 'CPCB / data.gov.in' | 'OpenAQ'
  station: string
  city?: string
  state?: string
  latitude?: number | null
  longitude?: number | null
  distanceKm?: number | null
  pollutant: 'PM2.5'
  value: number
  unit: string
  observedAt: string | null
  stale: boolean
  url: string
  id?: string
  providerStationId?: string
  sensorId?: string
  canonicalStationId?: string | null
  originId?: string | null
  statistic?: string
  period?: { start: string; end: string } | null
  owner?: string | null
  upstreamProvider?: string | null
  qualityStatus?: string
  qualityFlags?: unknown[]
  referenceMonitor?: boolean | null
  instruments?: string[]
  siting?: 'not_verified'
}
export type SourceStatus = {
  status:
    | 'live'
    | 'stale'
    | 'not_configured'
    | 'unavailable'
    | 'no_data'
    | 'pending'
    | 'unverified'
  message?: string
  lastAttemptAt?: string | null
  lastSuccessAt?: string | null
}
export type DashboardData = {
  schemaVersion?: number
  snapshotId?: string
  pending?: boolean
  ingestionPaused?: boolean
  ingestionWarning?: string | null
  policy?: {
    date: string
    version: string
    status: string
    message: string
    records: {
      id: string
      title: string
      url: string
      reviewedAt: string
      instruction?: string
    }[]
    sources: { name: string; url: string }[]
  }
  coverage?: {
    state: string
    returnedStationCount: number
    nearestDistanceKm: number | null
    searchRadiusKm: number
    catalogAt: number | null
    message: string
  }
  comparison?: {
    eligible: boolean
    sharedOrigin: boolean
    reasons: string[]
    message: string
  } | null
  nearbyMonitors?: Monitor[]
  location: Place
  forecast: {
    id?: string
    issuedAt?: string | null
    points: ForecastPoint[]
    fetchedAt: string
    timezone: string
    grid: { latitude: number; longitude: number }
    source: string
    pollutants?: Partial<Record<Pollutant, PollutantSeries>>
  } | null
  monitors: Monitor[]
  sources: { forecast?: SourceStatus; cpcb: SourceStatus; openaq: SourceStatus }
}
export type Activity = {
  id: string
  start: string
  end: string
  activity: string
  place: string
  days: number[]
  flexible?: boolean
  allowedStart?: string
  allowedEnd?: string
  indoorAvailable?: boolean
  intensity?: 'low' | 'moderate' | 'high'
}
export type OutdoorPlan = {
  name: string
  threshold: number
  activities: Activity[]
  configured: boolean
  ruleMode?: 'example' | 'custom'
}
export type ActivityDecision =
  'pending' | 'indoors' | 'outdoors' | 'cancelled' | 'rescheduled' | 'shortened'
export type StorageKey = 'location' | 'plan'
export type ReviewedLocation = {
  key: string
  areaId: string
  name: string
  state: string
  latitude: number
  longitude: number
}
export type DecisionAssessment = {
  value: number | null
  coverage: 'missing' | 'partial' | 'complete'
  review: boolean
  freshness: 'fresh' | 'stale' | 'future' | 'unknown'
}
export type DecisionRecord = {
  id: string
  activityId: string
  activity: string
  date: string
  at: string
  choice: ActivityDecision
  reason: string
  proposedStart?: string
  proposedEnd?: string
  snapshotId: string
  planVersion: string
  threshold: number
  forecastId?: string
  value: number | null
  coverage: string
  policyVersion?: string
  sourceAt?: string
  location?: ReviewedLocation
  originalWindow?: { start: string; end: string }
  chosenWindow?: { start: string; end: string }
  originalAssessment?: DecisionAssessment
  chosenAssessment?: DecisionAssessment
  policyStatus?: string
  lifecycle?: 'recorded' | 'reopened' | 'superseded'
  reopenedAt?: string
  supersededBy?: string
  followThrough: 'unconfirmed' | 'completed' | 'changed'
  kind?: 'scheduled' | 'one_off'
  reviewedActivity?: Activity
  reviewedPlanName?: string
  forecastSource?: string
  modelEstimate?: {
    version: 1
    unit: 'µg·h/m³'
    method: 'hourly_sample_hold'
    original: number | null
    chosen: number | null
    originalCoveredHours: number
    chosenCoveredHours: number
  }
}
export type Language = 'en' | 'hi'
export type OneOffPlan = {
  id: string
  date: string
  locationKey: string
  plan: OutdoorPlan
}
export type LocalState = {
  groups?: import('./lib/groups.ts').LocalGroup[]
  plan: OutdoorPlan
  journal: DecisionRecord[]
  oneOffs: OneOffPlan[]
  dismissedAlerts: string[]
  language: Language
  favorites: FavoritePlace[]
  feedback: SuggestionFeedback[]
}
