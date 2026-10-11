import { CognitoJwtVerifier } from 'aws-jwt-verify'
import { ApiError, hash, timestamp, validDate } from './core.mjs'
import { enqueue } from './services.mjs'
import { groupsRoute } from './groups.mjs'
import { subscriptionsRoute } from './subscriptions.mjs'
import { policyFor } from './policies.mjs'
import { validatePlan, planVersion } from '../src/lib/planner.ts'
import {
  assessWindow,
  assessmentReviewReasons,
} from '../src/lib/decision-evidence.ts'

let verifier
export async function membership(event, store) {
  if (!process.env.COGNITO_USER_POOL_ID || !process.env.COGNITO_CLIENT_ID)
    throw new ApiError(
      'Shared workspaces are not configured on this deployment.',
      503,
    )
  const bearer =
    event.headers?.authorization || event.headers?.Authorization || ''
  if (!bearer.startsWith('Bearer '))
    throw new ApiError('Sign in to use a shared workspace.', 401)
  verifier ||= CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID,
    tokenUse: 'access',
    clientId: process.env.COGNITO_CLIENT_ID,
  })
  let identity
  try {
    identity = await verifier.verify(bearer.slice(7))
  } catch {
    throw new ApiError('Sign-in expired or is invalid. Sign in again.', 401)
  }
  const row = await store.get('MEMBERS', identity.sub)
  if (
    !row ||
    !['owner', 'approver', 'reviewer'].includes(row.data.role) ||
    !row.data.workspaceId
  )
    throw new ApiError(
      'Your account has no workspace membership. Contact its owner.',
      403,
      'workspace_membership_revoked',
    )
  const preferences = await store.get(`PREFERENCES#${identity.sub}`)
  return {
    ...row.data,
    notifications: Boolean(preferences?.data.enabled),
    sub: identity.sub,
  }
}
export function validateSharedPlan(plan) {
  if (
    !plan ||
    typeof plan.name !== 'string' ||
    !plan.name.trim() ||
    plan.name.length > 80 ||
    !Number.isFinite(plan.threshold) ||
    plan.threshold < 1 ||
    plan.threshold > 1000 ||
    !Array.isArray(plan.activities) ||
    plan.activities.length > 50
  )
    throw new ApiError('Shared plan is invalid.')
  const ids = new Set()
  for (const item of plan.activities) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.activity !== 'string' ||
      !item.activity.trim() ||
      item.activity.length > 80 ||
      typeof item.place !== 'string' ||
      item.place.length > 80 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.end) ||
      item.end <= item.start ||
      !Array.isArray(item.days) ||
      !item.days.length ||
      item.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
    )
      throw new ApiError('A shared activity is invalid.')
    ids.add(item.id)
    if (
      item.flexible &&
      (!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.allowedStart || '') ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.allowedEnd || '') ||
        item.allowedEnd <= item.allowedStart)
    )
      throw new ApiError('The allowed activity range is invalid.')
  }
  const clean = {
    name: plan.name.trim(),
    threshold: plan.threshold,
    configured: true,
    ruleMode: plan.ruleMode === 'example' ? 'example' : 'custom',
    activities: plan.activities.map((item) => ({
      id: item.id,
      activity: item.activity.trim(),
      place: item.place.trim(),
      start: item.start,
      end: item.end,
      days: [...new Set(item.days)],
      flexible: Boolean(item.flexible),
      allowedStart: item.allowedStart || item.start,
      allowedEnd: item.allowedEnd || item.end,
      indoorAvailable: Boolean(item.indoorAvailable),
      intensity: ['low', 'moderate', 'high'].includes(item.intensity)
        ? item.intensity
        : 'moderate',
    })),
  }
  const errors = validatePlan(clean)
  if (Object.keys(errors).length) throw new ApiError(Object.values(errors)[0])
  return clean
}
function modelAssessment(activity, date, threshold, forecast, fetchedAt) {
  const assessment = assessWindow(
    activity,
    forecast?.points || [],
    date,
    threshold,
    Date.now(),
    fetchedAt || forecast?.fetchedAt,
  )
  return {
    ...assessment,
    // Retain this field for existing shared-workspace clients and records.
    fresh: assessment.freshness === 'fresh',
  }
}
function commit(
  store,
  member,
  action,
  pk,
  sk,
  data,
  expected,
  details,
  checks = [],
) {
  if (checks.length) {
    const at = new Date().toISOString()
    return store.transaction([
      { pk, sk, data, expected },
      ...checks,
      {
        pk: `AUDIT#${member.workspaceId}`,
        sk: `${at}#${crypto.randomUUID()}`,
        data: { actor: member.sub, role: member.role, action, details, at },
      },
    ])
  }
  return store.replaceWithAudit(
    pk,
    sk,
    data,
    expected,
    `AUDIT#${member.workspaceId}`,
    {
      actor: member.sub,
      role: member.role,
      action,
      details,
      at: new Date().toISOString(),
    },
  )
}
export async function workspaceRoute(method, path, body, member, store) {
  const partition = `WORKSPACE#${member.workspaceId}`
  if (path === '/api/workspace/groups')
    return groupsRoute(method, body, member, store)
  if (path === '/api/workspace/subscriptions')
    return subscriptionsRoute(method, body, member, store)
  if (method === 'GET' && path === '/api/workspace') {
    const [plan, records, audit, groups] = await Promise.all([
      store.get(partition, 'plan'),
      store.list(`DECISIONS#${member.workspaceId}`, 200),
      store.list(`AUDIT#${member.workspaceId}`, 200),
      store.get(partition, 'groups'),
    ])
    return {
      membership: member,
      plan: plan?.data || null,
      version: plan?.version || 0,
      decisions: records.map((row) => ({ ...row.data, version: row.version })),
      audit: audit.map((row) => row.data),
      groups: groups?.data.groups || [],
      groupVersion: groups?.version || 0,
    }
  }
  if (method === 'PUT' && path === '/api/workspace/plan') {
    if (!['owner', 'approver'].includes(member.role))
      throw new ApiError(
        'An owner or approver must update the shared plan.',
        403,
      )
    const plan = validateSharedPlan(body.plan),
      expected = body.version
    if (!Number.isInteger(expected) || expected < 0)
      throw new ApiError('A plan version is required.')
    if (
      !(await commit(
        store,
        member,
        'plan_saved',
        partition,
        'plan',
        plan,
        expected,
        { version: expected + 1, planHash: hash(plan) },
      ))
    )
      throw new ApiError(
        'Another member updated this plan. Reload before saving.',
        409,
      )
    return { plan, version: expected + 1 }
  }
  if (method === 'POST' && path === '/api/workspace/decisions') {
    const record = body.record
    if (['reopened', 'superseded'].includes(record?.lifecycle))
      throw new ApiError(
        'This decision was reopened or superseded. Record a newly reviewed decision before submitting.',
        409,
      )
    if (
      !record ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(record.id || '') ||
      !/^[a-f0-9]{32}$/.test(record.snapshotId || '') ||
      !timestamp(record.at) ||
      ![
        'indoors',
        'outdoors',
        'cancelled',
        'rescheduled',
        'shortened',
      ].includes(record.choice) ||
      typeof record.reason !== 'string' ||
      !record.reason.trim() ||
      record.reason.length > 500 ||
      typeof record.activity !== 'string' ||
      record.activity.length > 80 ||
      !validDate(record.date)
    )
      throw new ApiError(
        'A valid decision, reason, date and evidence ID are required.',
      )
    const decisionPartition = `DECISIONS#${member.workspaceId}`
    const submissionHash = hash({
      record,
      plan: record.kind === 'one_off' ? body.plan : null,
    })
    const existing = await store.get(decisionPartition, record.id)
    if (existing) {
      if (
        existing.data.author === member.sub &&
        existing.data.submissionHash === submissionHash &&
        (existing.data.replaces || null) === (body.supersedes || null)
      )
        return { ...existing.data, version: existing.version }
      throw new ApiError(
        'This decision ID already contains another proposal. Reload its current state.',
        409,
      )
    }
    const [evidence, workspacePlan] = await Promise.all([
      store.get(`EVIDENCE#${record.snapshotId}`),
      store.get(partition, 'plan'),
    ])
    const oneOff = record.kind === 'one_off'
    const sharedPlan = oneOff
      ? { data: validateSharedPlan(body.plan), version: 0 }
      : workspacePlan
    if (
      oneOff &&
      (sharedPlan.data.activities.length !== 1 ||
        record.planVersion !== planVersion(body.plan))
    )
      throw new ApiError(
        'Quick activity settings do not match the reviewed record.',
        409,
      )
    if (
      !evidence ||
      evidence.expireAt <= Date.now() / 1000 ||
      evidence.data.date !== record.date ||
      evidence.data.sample ||
      evidence.data.replay ||
      (record.location?.areaId && evidence.data.area !== record.location.areaId)
    )
      throw new ApiError(
        'Evidence is unavailable or belongs to another date. Refresh and review again.',
        409,
      )
    const activity = sharedPlan?.data.activities.find(
      (item) => item.id === record.activityId,
    )
    if (!activity)
      throw new ApiError(
        'Save this activity in the shared plan before submitting a decision.',
        409,
      )
    if (!oneOff && record.planVersion !== planVersion(sharedPlan.data))
      throw new ApiError(
        'This decision was reviewed with a different plan. Use the shared plan locally and record a newly reviewed decision.',
        409,
      )
    const clock = (value) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return NaN
      const [a, b] = value.split(':').map(Number)
      return a * 60 + b
    }
    if (['rescheduled', 'shortened'].includes(record.choice)) {
      const duration = clock(record.proposedEnd) - clock(record.proposedStart),
        original = clock(activity.end) - clock(activity.start)
      if (
        !(duration > 0) ||
        (record.choice === 'rescheduled' &&
          (!activity.flexible ||
            record.proposedStart < activity.allowedStart ||
            record.proposedEnd > activity.allowedEnd ||
            duration !== original)) ||
        (record.choice === 'shortened' &&
          (duration >= original ||
            record.proposedStart < activity.start ||
            record.proposedEnd > activity.end))
      )
        throw new ApiError(
          'Chosen times do not follow the shared activity constraints.',
        )
    }
    const archivedForecast = evidence.data.forecastId
      ? await store.get(`FORECAST#${evidence.data.forecastId}`)
      : null
    const reviewedWindow = ['rescheduled', 'shortened'].includes(record.choice)
      ? { ...activity, start: record.proposedStart, end: record.proposedEnd }
      : activity
    const clean = {
      id: record.id,
      snapshotId: record.snapshotId,
      evidence: evidence.data,
      planVersion: sharedPlan.version,
      threshold: sharedPlan.data.threshold,
      activityWindow: { start: activity.start, end: activity.end },
      modelAssessment: modelAssessment(
        reviewedWindow,
        record.date,
        sharedPlan.data.threshold,
        archivedForecast?.data,
        evidence.data.forecastFetchedAt,
      ),
      at: record.at,
      choice: record.choice,
      reason: record.reason.trim(),
      activity: activity.activity,
      activityId: activity.id,
      date: record.date,
      proposedStart: record.proposedStart || null,
      proposedEnd: record.proposedEnd || null,
      author: member.sub,
      approval: 'pending',
      delivery: 'not_requested',
      followThrough: 'unconfirmed',
      lifecycle: 'recorded',
      kind: oneOff ? 'one_off' : 'scheduled',
      proposalPlan: oneOff ? sharedPlan.data : null,
      submissionHash,
    }
    const planChecks = oneOff
      ? []
      : [
          {
            pk: partition,
            sk: 'plan',
            check: true,
            expected: sharedPlan.version,
          },
        ]
    if (body.supersedes) {
      const previous = await store.get(decisionPartition, body.supersedes)
      if (
        !previous ||
        previous.version !== body.version ||
        previous.data.lifecycle === 'superseded' ||
        previous.data.date !== clean.date ||
        previous.data.activityId !== clean.activityId ||
        previous.data.evidence.area !== clean.evidence.area ||
        (previous.data.author !== member.sub &&
          !['owner', 'approver'].includes(member.role))
      )
        throw new ApiError(
          'The proposal to replace changed or is outside this activity scope. Reload.',
          409,
        )
      const at = new Date().toISOString()
      if (
        !(await store.transaction([
          {
            pk: decisionPartition,
            sk: clean.id,
            data: { ...clean, replaces: previous.data.id },
            expected: 0,
          },
          {
            pk: decisionPartition,
            sk: previous.data.id,
            data: {
              ...previous.data,
              lifecycle: 'superseded',
              supersededBy: clean.id,
              delivery: 'suppressed',
            },
            expected: previous.version,
          },
          ...planChecks,
          {
            pk: `AUDIT#${member.workspaceId}`,
            sk: `${at}#${crypto.randomUUID()}`,
            data: {
              actor: member.sub,
              role: member.role,
              action: 'decision_superseded',
              at,
              details: { previous: previous.data.id, replacement: clean.id },
            },
          },
        ]))
      )
        throw new ApiError(
          'The proposal changed during replacement. Reload.',
          409,
        )
      return { ...clean, replaces: previous.data.id, version: 1 }
    }
    if (
      !(await commit(
        store,
        member,
        'decision_proposed',
        `DECISIONS#${member.workspaceId}`,
        record.id,
        clean,
        0,
        { id: record.id, snapshotId: record.snapshotId },
        planChecks,
      ))
    )
      throw new ApiError('This decision already exists.', 409)
    return { ...clean, version: 1 }
  }
  const reopening = path.match(
    /^\/api\/workspace\/decisions\/([a-zA-Z0-9_-]{1,80})\/reopen$/,
  )
  if (method === 'POST' && reopening) {
    const pk = `DECISIONS#${member.workspaceId}`,
      row = await store.get(pk, reopening[1])
    if (!row) throw new ApiError('Decision not found.', 404)
    if (row.version !== body.version || row.data.lifecycle === 'superseded')
      throw new ApiError('Decision changed. Reload before reopening.', 409)
    if (
      row.data.author !== member.sub &&
      !['owner', 'approver'].includes(member.role)
    )
      throw new ApiError(
        'Only its author or an approver can reopen this proposal.',
        403,
      )
    if (
      typeof body.reason !== 'string' ||
      !body.reason.trim() ||
      body.reason.length > 500
    )
      throw new ApiError('Enter a reason for reopening (up to 500 characters).')
    const clean = {
      ...row.data,
      lifecycle: 'reopened',
      approval: 'reopened',
      delivery: 'suppressed',
      reopenedAt: new Date().toISOString(),
      reopenedBy: member.sub,
      reopenReason: body.reason.trim(),
    }
    if (
      !(await commit(
        store,
        member,
        'decision_reopened',
        pk,
        row.sk,
        clean,
        row.version,
        { id: row.sk, reason: clean.reopenReason },
      ))
    )
      throw new ApiError('Decision changed. Reload.', 409)
    return { ...clean, version: row.version + 1 }
  }
  const approval = path.match(
    /^\/api\/workspace\/decisions\/([a-zA-Z0-9_-]{1,80})\/approve$/,
  )
  if (method === 'POST' && approval) {
    if (!['owner', 'approver'].includes(member.role))
      throw new ApiError(
        'An approver or owner must approve this decision.',
        403,
      )
    const row = await store.get(`DECISIONS#${member.workspaceId}`, approval[1])
    if (!row) throw new ApiError('Decision not found.', 404)
    if (body.version !== undefined && body.version !== row.version)
      throw new ApiError('Decision changed. Reload before approval.', 409)
    if (['reopened', 'superseded'].includes(row.data.lifecycle))
      throw new ApiError(
        'This proposal needs a newly reviewed replacement.',
        409,
      )
    if (row.data.approval === 'approved')
      return { ...row.data, version: row.version }
    const latestPlan =
      row.data.kind === 'one_off'
        ? { data: row.data.proposalPlan, version: 0 }
        : await store.get(partition, 'plan')
    if (latestPlan?.version !== row.data.planVersion)
      throw new ApiError(
        'The shared plan changed after this proposal. Submit a newly reviewed decision.',
        409,
      )
    const currentPolicy = await policyFor(
      row.data.evidence.jurisdiction || { name: '', state: '' },
      row.data.date,
    )
    if (
      currentPolicy.version !== row.data.evidence.policyVersion ||
      currentPolicy.status !== row.data.evidence.policyStatus
    )
      throw new ApiError(
        'Policy evidence changed after this proposal. Check current guidance and submit a newly reviewed decision.',
        409,
      )
    const activity = latestPlan.data.activities.find(
      (item) => item.id === row.data.activityId,
    )
    if (!activity)
      throw new ApiError(
        'Activity was removed. Submit a newly reviewed decision.',
        409,
      )
    const reviewedWindow = ['rescheduled', 'shortened'].includes(
      row.data.choice,
    )
      ? {
          ...activity,
          start: row.data.proposedStart,
          end: row.data.proposedEnd,
        }
      : activity
    const latestForecast = row.data.evidence.area
      ? await store.get(`SOURCE#${row.data.evidence.area}`, 'forecast')
      : null
    if (
      latestForecast?.data.value?.forecast?.sample ||
      latestForecast?.data.value?.forecast?.replay
    )
      throw new ApiError(
        'Sample or replay evidence cannot approve a live proposal.',
        409,
      )
    const currentAssessment = modelAssessment(
      reviewedWindow,
      row.data.date,
      latestPlan.data.threshold,
      latestForecast?.data.value?.forecast,
    )
    const previousAssessment = row.data.modelAssessment
    if (
      previousAssessment &&
      assessmentReviewReasons(
        {
          ...previousAssessment,
          freshness:
            previousAssessment.freshness ??
            (previousAssessment.fresh === true
              ? 'fresh'
              : previousAssessment.fresh === false
                ? 'stale'
                : 'unknown'),
        },
        currentAssessment,
      ).length
    )
      throw new ApiError(
        'Forecast evidence changed materially after this proposal. Refresh and submit a newly reviewed decision.',
        409,
      )
    if (
      currentAssessment.coverage !== 'complete' ||
      currentAssessment.freshness !== 'fresh'
    )
      throw new ApiError(
        'Current chosen-window evidence is incomplete or old. Refresh and review before approval.',
        409,
      )
    const clean = {
      ...row.data,
      approval: 'approved',
      approvedBy: member.sub,
      approvedAt: new Date().toISOString(),
      delivery:
        member.notifications && member.emailVerified
          ? 'queued'
          : 'not_requested',
    }
    if (
      !(await commit(
        store,
        member,
        'decision_approved',
        `DECISIONS#${member.workspaceId}`,
        approval[1],
        clean,
        row.version,
        { id: clean.id },
        row.data.kind === 'one_off'
          ? []
          : [
              {
                pk: partition,
                sk: 'plan',
                expected: latestPlan.version,
                check: true,
              },
            ],
      ))
    )
      throw new ApiError('Decision changed; reload before approval.', 409)
    if (clean.delivery === 'queued') {
      try {
        await enqueue(
          {
            type: 'notification',
            workspaceId: member.workspaceId,
            decisionId: clean.id,
            recipientSub: member.sub,
          },
          true,
        )
      } catch {
        const current = await store.get(
          `DECISIONS#${member.workspaceId}`,
          clean.id,
        )
        await store.replace(
          `DECISIONS#${member.workspaceId}`,
          clean.id,
          { ...current.data, delivery: 'failed' },
          current.version,
        )
        clean.delivery = 'failed'
      }
    }
    return { ...clean, version: row.version + 1 }
  }
  if (method === 'PUT' && path === '/api/workspace/notifications') {
    if (typeof body.enabled !== 'boolean')
      throw new ApiError('Choose a notification preference.')
    const preferences = await store.get(`PREFERENCES#${member.sub}`)
    if (
      !(await commit(
        store,
        member,
        'notification_preference',
        `PREFERENCES#${member.sub}`,
        'current',
        {
          enabled: body.enabled,
          at: new Date().toISOString(),
        },
        preferences?.version || 0,
        { enabled: body.enabled },
      ))
    )
      throw new ApiError('Preference changed; reload before saving.', 409)
    return { enabled: body.enabled }
  }
  const followThrough = path.match(
    /^\/api\/workspace\/decisions\/([a-zA-Z0-9_-]{1,80})\/follow-through$/,
  )
  if (method === 'PUT' && followThrough) {
    if (!['followed', 'not_followed', 'unconfirmed'].includes(body.status))
      throw new ApiError('Choose a follow-through status.')
    const row = await store.get(
      `DECISIONS#${member.workspaceId}`,
      followThrough[1],
    )
    if (!row) throw new ApiError('Decision not found.', 404)
    if (body.version !== undefined && body.version !== row.version)
      throw new ApiError('Decision changed. Reload before saving.', 409)
    if (['reopened', 'superseded'].includes(row.data.lifecycle))
      throw new ApiError('This decision is no longer current.', 409)
    if (row.data.approval !== 'approved')
      throw new ApiError(
        'Approve this decision before recording shared follow-through.',
        409,
      )
    const clean = {
      ...row.data,
      followThrough: body.status,
      followThroughAt: new Date().toISOString(),
      followThroughBy: member.sub,
    }
    if (
      !(await commit(
        store,
        member,
        'follow_through_recorded',
        `DECISIONS#${member.workspaceId}`,
        followThrough[1],
        clean,
        row.version,
        { id: clean.id, status: body.status },
      ))
    )
      throw new ApiError('Decision changed; reload before saving.', 409)
    return { ...clean, version: row.version + 1 }
  }
  throw new ApiError('Workspace route not found.', 404)
}
