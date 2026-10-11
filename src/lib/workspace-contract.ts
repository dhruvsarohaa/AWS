import type { OutdoorPlan } from '../types.ts'
import type { SharedGroup } from './groups.ts'
import { validPlace } from './contracts.ts'
import { validLocalPlan } from './localRepository.ts'
export type Workspace = {
  membership: {
    role: string
    workspaceId: string
    notifications: boolean
    sub: string
  }
  plan: OutdoorPlan | null
  version: number
  groups: SharedGroup[]
  groupVersion: number
  audit: { at: string; actor: string; action: string }[]
  decisions: {
    id: string
    version: number
    lifecycle?: string
    author: string
    activityId: string
    reopenedAt?: string
    reopenReason?: string
    supersededBy?: string
    evidence: {
      policyStatus: string
      forecastFetchedAt: string | null
      area?: string
    }
    date: string
    activity: string
    choice: string
    reason: string
    snapshotId: string
    threshold: number
    activityWindow: { start: string; end: string }
    proposedStart: string | null
    proposedEnd: string | null
    modelAssessment: { value: number | null; coverage: string; fresh: boolean }
    approval: string
    delivery: string
    followThrough: string
  }[]
}
const text = (v: unknown, max = 100) =>
  typeof v === 'string' && v.length > 0 && v.length <= max
const time = (v: unknown) =>
  text(v, 60) && Number.isFinite(Date.parse(String(v)))
const clock = (v: unknown) =>
  typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const version = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
export function validWorkspace(value: unknown): value is Workspace {
  const w = value as Workspace
  if (
    !w ||
    !w.membership ||
    !['owner', 'approver', 'reviewer'].includes(w.membership.role) ||
    !text(w.membership.sub) ||
    !text(w.membership.workspaceId) ||
    typeof w.membership.notifications !== 'boolean' ||
    !version(w.version) ||
    !version(w.groupVersion) ||
    (w.plan !== null && !validLocalPlan(w.plan))
  )
    return false
  if (
    !Array.isArray(w.groups) ||
    w.groups.length > 10 ||
    new Set(w.groups.map((g) => g?.id)).size !== w.groups.length ||
    !w.groups.every(
      (g) =>
        g &&
        text(g.id, 80) &&
        text(g.name, 80) &&
        Array.isArray(g.sites) &&
        g.sites.length > 0 &&
        g.sites.length <= 5 &&
        new Set(g.sites.map((s) => `${s?.latitude},${s?.longitude}`)).size ===
          g.sites.length &&
        g.sites.every(
          (s) =>
            validPlace(s) &&
            Math.round(s.latitude * 10) / 10 === s.latitude &&
            Math.round(s.longitude * 10) / 10 === s.longitude,
        ),
    )
  )
    return false
  if (
    !Array.isArray(w.audit) ||
    w.audit.length > 200 ||
    !w.audit.every((a) => a && time(a.at) && text(a.actor) && text(a.action))
  )
    return false
  return (
    Array.isArray(w.decisions) &&
    w.decisions.length <= 200 &&
    new Set(w.decisions.map((r) => r?.id)).size === w.decisions.length &&
    w.decisions.every(
      (r) =>
        r &&
        text(r.id, 80) &&
        version(r.version) &&
        r.version > 0 &&
        text(r.author) &&
        text(r.activityId, 80) &&
        (r.lifecycle === undefined ||
          ['recorded', 'reopened', 'superseded'].includes(r.lifecycle)) &&
        /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
        Number.isFinite(Date.parse(`${r.date}T12:00:00Z`)) &&
        text(r.activity, 80) &&
        text(r.reason, 500) &&
        /^[a-f0-9]{32}$/.test(r.snapshotId) &&
        [
          'indoors',
          'outdoors',
          'cancelled',
          'rescheduled',
          'shortened',
        ].includes(r.choice) &&
        Number.isFinite(r.threshold) &&
        r.threshold >= 1 &&
        r.threshold <= 1000 &&
        r.activityWindow &&
        clock(r.activityWindow.start) &&
        clock(r.activityWindow.end) &&
        r.activityWindow.end > r.activityWindow.start &&
        (r.proposedStart === null || clock(r.proposedStart)) &&
        (r.proposedEnd === null || clock(r.proposedEnd)) &&
        r.evidence &&
        text(r.evidence.policyStatus) &&
        (r.evidence.forecastFetchedAt === null ||
          time(r.evidence.forecastFetchedAt)) &&
        r.modelAssessment &&
        (r.modelAssessment.value === null ||
          (Number.isFinite(r.modelAssessment.value) &&
            r.modelAssessment.value >= 0)) &&
        ['complete', 'partial', 'missing'].includes(
          r.modelAssessment.coverage,
        ) &&
        typeof r.modelAssessment.fresh === 'boolean' &&
        ['pending', 'approved', 'reopened'].includes(r.approval) &&
        text(r.delivery) &&
        ['unconfirmed', 'followed', 'not_followed'].includes(r.followThrough) &&
        (r.reopenReason === undefined || text(r.reopenReason, 500)) &&
        (r.reopenedAt === undefined || time(r.reopenedAt)) &&
        (r.supersededBy === undefined || text(r.supersededBy, 80)),
    )
  )
}
export function readWorkspace(value: unknown): Workspace {
  if (!validWorkspace(value))
    throw new Error(
      'Workspace response failed validation. Reload before making changes.',
    )
  return value
}
