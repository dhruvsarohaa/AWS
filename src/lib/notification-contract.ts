import type { OutdoorPlan } from '../types.ts'
import { validLocalPlan } from './localRepository.ts'
export type NotificationSettings = {
  enabled: boolean
  plan?: OutdoorPlan
  quietStart?: string
  quietEnd?: string
  briefAt?: string
  reviewAlerts?: boolean
  dailyBrief?: boolean
  evaluationStatus?: string
  lastEvaluationAt?: string
  lastEvaluationError?: string | null
}
export type SubscriptionResponse = {
  subscription: NotificationSettings | null
  version: number
  deliveries: {
    id: string
    kind: string
    date: string
    status: string
    evidenceAt: string | null
  }[]
}
const clock = (v: unknown) =>
  typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
export function validSubscriptionResponse(
  value: unknown,
): value is SubscriptionResponse {
  const r = value as SubscriptionResponse,
    s = r?.subscription
  return Boolean(
    r &&
    Number.isSafeInteger(r.version) &&
    r.version >= 0 &&
    (s === null ||
      (s &&
        typeof s.enabled === 'boolean' &&
        (s.evaluationStatus === undefined ||
          ['evaluated', 'unavailable'].includes(s.evaluationStatus)) &&
        (s.lastEvaluationAt === undefined ||
          (typeof s.lastEvaluationAt === 'string' &&
            Number.isFinite(Date.parse(s.lastEvaluationAt)))) &&
        (s.lastEvaluationError == null ||
          (typeof s.lastEvaluationError === 'string' &&
            s.lastEvaluationError.length <= 2000)) &&
        (!s.enabled ||
          (validLocalPlan(s.plan) &&
            s.plan.activities.length <= 10 &&
            clock(s.quietStart) &&
            clock(s.quietEnd) &&
            clock(s.briefAt) &&
            typeof s.reviewAlerts === 'boolean' &&
            typeof s.dailyBrief === 'boolean')))) &&
    Array.isArray(r.deliveries) &&
    r.deliveries.length <= 30 &&
    r.deliveries.every(
      (d) =>
        d &&
        typeof d.id === 'string' &&
        d.id.length <= 100 &&
        ['review', 'brief'].includes(d.kind) &&
        typeof d.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(d.date) &&
        [
          'pending',
          'unknown',
          'accepted',
          'delivered',
          'suppressed',
          'failed',
          'local_only',
        ].includes(d.status) &&
        (d.evidenceAt === null ||
          (typeof d.evidenceAt === 'string' &&
            Number.isFinite(Date.parse(d.evidenceAt)))),
    ),
  )
}
