import assert from 'node:assert/strict'
import test from 'node:test'
import { MemoryStore } from '../api/store.mjs'
import {
  membership,
  workspaceRoute,
  validateSharedPlan,
} from '../api/workspaces.mjs'
import { deliver } from '../api/notifications.mjs'
import { sharedPlan, rawForecast } from './fixtures.mjs'
import { hash, validateForecast } from '../api/core.mjs'
import { planVersion } from '../src/lib/planner.ts'
const owner = {
    sub: 'owner-a',
    workspaceId: 'workspace-a',
    role: 'owner',
    notifications: false,
    emailVerified: true,
    email: 'owner@example.test',
  },
  reviewer = { ...owner, sub: 'reviewer-a', role: 'reviewer' },
  other = { ...owner, sub: 'owner-b', workspaceId: 'workspace-b' }
const call = (store, member, method, path, body = {}) =>
  workspaceRoute(method, `/api/workspace${path}`, body, member, store)
const snapshotId = 'a'.repeat(32)
async function setup() {
  const store = new MemoryStore()
  await call(store, owner, 'PUT', '/plan', { plan: sharedPlan, version: 0 })
  await store.put(
    `EVIDENCE#${snapshotId}`,
    'current',
    {
      date: '2030-10-08',
      forecastId: 'fixture',
      policyStatus: 'verification_needed',
      policyVersion: hash([]),
    },
    { expireAt: Date.now() / 1000 + 86400 },
  )
  return store
}
async function setupForecast(value, fetchedAt = new Date().toISOString()) {
  const store = await setup()
  const raw = rawForecast()
  raw.hourly.pm2_5[2] = value
  const forecast = { ...validateForecast(raw), fetchedAt }
  const evidence = await store.get(`EVIDENCE#${snapshotId}`)
  await store.put(
    `EVIDENCE#${snapshotId}`,
    'current',
    {
      ...evidence.data,
      area: 'fixture-area',
      forecastId: forecast.id,
      forecastFetchedAt: forecast.fetchedAt,
    },
    { expireAt: evidence.expireAt },
  )
  await store.replace(`FORECAST#${forecast.id}`, 'current', forecast, 0)
  await store.put('SOURCE#fixture-area', 'forecast', { value: { forecast } })
  return { store, forecast }
}
const record = () => ({
  id: 'decision-a',
  activityId: 'walk',
  activity: 'Untrusted browser label',
  date: '2030-10-08',
  snapshotId,
  at: new Date().toISOString(),
  choice: 'rescheduled',
  proposedStart: '10:00',
  proposedEnd: '11:00',
  reason: 'SYNTHETIC TEST: choose a lower forecast window',
  planVersion: planVersion(sharedPlan),
})

test('shared plan contract rejects duplicate IDs and invalid flexible ranges', () => {
  assert.throws(() =>
    validateSharedPlan({
      ...sharedPlan,
      activities: [sharedPlan.activities[0], sharedPlan.activities[0]],
    }),
  )
  assert.throws(() =>
    validateSharedPlan({
      ...sharedPlan,
      activities: [{ ...sharedPlan.activities[0], allowedStart: '25:00' }],
    }),
  )
  assert.throws(() =>
    validateSharedPlan({
      ...sharedPlan,
      activities: [
        {
          ...sharedPlan.activities[0],
          allowedStart: '08:00',
          allowedEnd: '08:30',
        },
      ],
    }),
  )
})
test('reviewers cannot change shared plans or approve decisions', async () => {
  const store = await setup()
  await assert.rejects(
    call(store, reviewer, 'PUT', '/plan', { plan: sharedPlan, version: 1 }),
    { status: 403 },
  )
  await assert.rejects(
    call(store, reviewer, 'POST', '/decisions/decision-a/approve'),
    { status: 403 },
  )
})
test('workspace partitions come from trusted membership, ignoring browser tenant IDs', async () => {
  const store = await setup()
  await call(store, owner, 'POST', '/decisions', {
    record: record(),
    workspaceId: 'workspace-b',
  })
  const foreign = await call(store, other, 'GET', '', {
    workspaceId: 'workspace-a',
  })
  assert.equal(foreign.plan, null)
  assert.equal(foreign.decisions.length, 0)
  await assert.rejects(
    call(store, other, 'POST', '/decisions/decision-a/approve'),
    { status: 404 },
  )
})
test('optimistic versions prevent a stale shared plan overwrite', async () => {
  const store = await setup()
  await call(store, owner, 'PUT', '/plan', {
    plan: { ...sharedPlan, name: 'changed' },
    version: 1,
  })
  await assert.rejects(
    call(store, owner, 'PUT', '/plan', { plan: sharedPlan, version: 1 }),
    { status: 409 },
  )
})
test('decisions require server-held evidence and shared activity constraints', async () => {
  const store = await setup()
  await assert.rejects(
    call(store, reviewer, 'POST', '/decisions', {
      record: { ...record(), snapshotId: 'b'.repeat(32) },
    }),
    { status: 409 },
  )
  await assert.rejects(
    call(store, reviewer, 'POST', '/decisions', {
      record: { ...record(), proposedEnd: '11:30' },
    }),
    { status: 400 },
  )
  const clean = await call(store, reviewer, 'POST', '/decisions', {
    record: record(),
  })
  assert.equal(clean.activity, 'Synthetic walk')
  assert.equal(clean.threshold, 75)
  assert.equal(clean.planVersion, 1)
  assert.equal(clean.evidence.policyStatus, 'verification_needed')
  assert.equal(clean.approval, 'pending')
})

test('reopened and superseded local actions cannot be submitted, while legacy lifecycle remains compatible', async () => {
  const store = await setup()
  for (const lifecycle of ['reopened', 'superseded'])
    await assert.rejects(
      call(store, reviewer, 'POST', '/decisions', {
        record: { ...record(), lifecycle },
      }),
      { status: 409, message: /reopened or superseded/ },
    )
  assert.equal((await store.list('DECISIONS#workspace-a')).length, 0)
  const legacy = await call(store, reviewer, 'POST', '/decisions', {
    record: record(),
  })
  assert.equal(legacy.approval, 'pending')
})
test('changed plans invalidate pending approval and audit records are retained', async () => {
  const store = await setup()
  await call(store, reviewer, 'POST', '/decisions', { record: record() })
  await call(store, owner, 'PUT', '/plan', {
    plan: { ...sharedPlan, threshold: 80 },
    version: 1,
  })
  await assert.rejects(
    call(store, owner, 'POST', '/decisions/decision-a/approve'),
    { status: 409 },
  )
  assert.equal((await call(store, owner, 'GET', '')).audit.length, 3)
})

test('submitting with a different locally reviewed plan cannot silently adopt shared rules', async () => {
  const store = await setup()
  await assert.rejects(
    call(store, reviewer, 'POST', '/decisions', {
      record: {
        ...record(),
        planVersion: planVersion({ ...sharedPlan, threshold: 100 }),
      },
    }),
    { status: 409 },
  )
  assert.equal((await store.list('DECISIONS#workspace-a')).length, 0)
})
test('approval and follow-through persist with actor attribution', async () => {
  const { store } = await setupForecast(40)
  await call(store, reviewer, 'POST', '/decisions', { record: record() })
  const approved = await call(
    store,
    owner,
    'POST',
    '/decisions/decision-a/approve',
  )
  assert.equal(approved.approval, 'approved')
  assert.equal(approved.delivery, 'not_requested')
  assert.equal(
    (await call(store, owner, 'POST', '/decisions/decision-a/approve'))
      .approvedAt,
    approved.approvedAt,
  )
  const result = await call(
    store,
    reviewer,
    'PUT',
    '/decisions/decision-a/follow-through',
    { status: 'followed' },
  )
  assert.equal(result.followThroughBy, reviewer.sub)
})

test('material forecast changes and stale or future evidence invalidate pending approval', async () => {
  for (const changed of ['value', 'coverage', 'freshness', 'future']) {
    const store = await setup(),
      forecast = validateForecast(rawForecast())
    const evidence = await store.get(`EVIDENCE#${snapshotId}`)
    await store.put(
      `EVIDENCE#${snapshotId}`,
      'current',
      {
        ...evidence.data,
        area: 'fixture-area',
        forecastId: forecast.id,
        forecastFetchedAt: forecast.fetchedAt,
      },
      { expireAt: evidence.expireAt },
    )
    await store.replace(`FORECAST#${forecast.id}`, 'current', forecast, 0)
    const proposed = await call(store, reviewer, 'POST', '/decisions', {
      record: record(),
    })
    assert.equal(proposed.modelAssessment.value, 30)
    const points = forecast.points.map((point) =>
      point.time.includes('T10:00')
        ? {
            ...point,
            pm25:
              changed === 'value'
                ? 100
                : changed === 'coverage'
                  ? null
                  : point.pm25,
          }
        : point,
    )
    await store.put('SOURCE#fixture-area', 'forecast', {
      value: {
        forecast: {
          ...forecast,
          points,
          fetchedAt:
            changed === 'freshness'
              ? new Date(Date.now() - 3 * 3600000).toISOString()
              : changed === 'future'
                ? new Date(Date.now() + 10 * 60_000).toISOString()
                : forecast.fetchedAt,
        },
      },
    })
    await assert.rejects(
      call(store, owner, 'POST', '/decisions/decision-a/approve'),
      { status: 409 },
    )
    assert.equal(
      (await store.get('DECISIONS#workspace-a', 'decision-a')).data.approval,
      'pending',
    )
  }
})

test('chosen-window crossings 74 to 76 and 76 to 74 invalidate approval while original hours stay unchanged', async () => {
  for (const [previous, current] of [
    [74, 76],
    [76, 74],
  ]) {
    const { store, forecast } = await setupForecast(previous)
    const proposed = await call(store, reviewer, 'POST', '/decisions', {
      record: record(),
    })
    assert.equal(proposed.modelAssessment.value, previous)
    assert.equal(proposed.modelAssessment.review, previous > 75)
    assert.equal(proposed.modelAssessment.freshness, 'fresh')
    assert.equal(proposed.modelAssessment.fresh, true)
    const points = forecast.points.map((point) =>
      point.time.includes('T10:00') ? { ...point, pm25: current } : point,
    )
    assert.equal(
      points.find((point) => point.time.includes('T08:00')).pm25,
      100,
    )
    await store.put('SOURCE#fixture-area', 'forecast', {
      value: { forecast: { ...forecast, points } },
    })
    await assert.rejects(
      call(store, owner, 'POST', '/decisions/decision-a/approve'),
      { status: 409, message: /Forecast evidence changed materially/ },
    )
    assert.equal(
      (await store.get('DECISIONS#workspace-a', 'decision-a')).data.approval,
      'pending',
    )
  }
})

test('legacy assessments retain fresh compatibility while stale evidence blocks approval', async () => {
  for (const fresh of [true, false]) {
    const { store } = await setupForecast(
      40,
      new Date(Date.now() - (fresh ? 60_000 : 3 * 3600000)).toISOString(),
    )
    await call(store, reviewer, 'POST', '/decisions', { record: record() })
    const row = await store.get('DECISIONS#workspace-a', 'decision-a')
    const legacyAssessment = { ...row.data.modelAssessment }
    delete legacyAssessment.freshness
    assert.equal(legacyAssessment.fresh, fresh)
    await store.replace(
      'DECISIONS#workspace-a',
      'decision-a',
      {
        ...row.data,
        modelAssessment: legacyAssessment,
      },
      row.version,
    )
    const approval = call(store, owner, 'POST', '/decisions/decision-a/approve')
    if (fresh) assert.equal((await approval).approval, 'approved')
    else
      await assert.rejects(approval, {
        status: 409,
        message: /incomplete or old/,
      })
  }
})
test('notification preference cannot overwrite a member role or organization', async () => {
  const store = await setup()
  await store.put('MEMBERS', owner.sub, {
    workspaceId: 'new-workspace',
    role: 'reviewer',
  })
  await call(store, owner, 'PUT', '/notifications', {
    enabled: true,
    role: 'owner',
    workspaceId: 'workspace-a',
  })
  assert.deepEqual((await store.get('MEMBERS', owner.sub)).data, {
    workspaceId: 'new-workspace',
    role: 'reviewer',
  })
  assert.equal((await store.get(`PREFERENCES#${owner.sub}`)).data.enabled, true)
})
test('missing and malformed bearer tokens never resolve workspace access', async () => {
  const oldPool = process.env.COGNITO_USER_POOL_ID,
    oldClient = process.env.COGNITO_CLIENT_ID
  process.env.COGNITO_USER_POOL_ID = 'ap-south-1_TestFixture'
  process.env.COGNITO_CLIENT_ID = 'fixture'
  try {
    await assert.rejects(membership({ headers: {} }, new MemoryStore()), {
      status: 401,
    })
    await assert.rejects(
      membership(
        { headers: { authorization: 'Bearer not-a-jwt' } },
        new MemoryStore(),
      ),
      { status: 401 },
    )
  } finally {
    if (oldPool === undefined) delete process.env.COGNITO_USER_POOL_ID
    else process.env.COGNITO_USER_POOL_ID = oldPool
    if (oldClient === undefined) delete process.env.COGNITO_CLIENT_ID
    else process.env.COGNITO_CLIENT_ID = oldClient
  }
})
async function deliverySetup(optIn = true) {
  const store = new MemoryStore()
  await store.put('MEMBERS', 'member', {
    workspaceId: 'a',
    role: 'reviewer',
    email: 'fixture@example.test',
    emailVerified: true,
  })
  await store.put('PREFERENCES#member', 'current', { enabled: optIn })
  await store.replace(
    'DECISIONS#a',
    'd',
    {
      approval: 'approved',
      delivery: 'queued',
      activity: 'SYNTHETIC',
      choice: 'indoors',
      date: '2030-10-08',
      reason: 'Test only',
      snapshotId,
      approvedAt: new Date().toISOString(),
    },
    0,
  )
  return {
    store,
    job: {
      type: 'notification',
      workspaceId: 'a',
      decisionId: 'd',
      recipientSub: 'member',
    },
  }
}
test('email delivery requires opt-in and matching membership', async () => {
  const { store, job } = await deliverySetup(false)
  let sent = 0
  await deliver(job, store, 'fixture@example.test', async () => {
    sent++
  })
  await store.put('PREFERENCES#member', 'current', { enabled: true })
  await store.put('MEMBERS', 'member', {
    workspaceId: 'b',
    email: 'fixture@example.test',
    emailVerified: true,
  })
  await deliver(job, store, 'fixture@example.test', async () => {
    sent++
  })
  assert.equal(sent, 0)
})
test('duplicate queue deliveries send once and ambiguous SES delivery is not retried', async () => {
  const { store, job } = await deliverySetup()
  let sent = 0
  await deliver(job, store, 'fixture@example.test', async () => {
    sent++
    return { MessageId: 'synthetic' }
  })
  await deliver(job, store, 'fixture@example.test', async () => {
    sent++
  })
  assert.equal(sent, 1)
  assert.equal((await store.get('DECISIONS#a', 'd')).data.delivery, 'accepted')
  const second = await deliverySetup()
  await deliver(second.job, second.store, 'fixture@example.test', async () => {
    throw new Error('synthetic timeout')
  })
  await deliver(second.job, second.store, 'fixture@example.test', async () => {
    sent++
  })
  assert.equal(
    (await second.store.get('DECISIONS#a', 'd')).data.delivery,
    'delivery_unknown',
  )
  assert.equal(sent, 1)
})
test('unconfigured SES is an explicit delivery state', async () => {
  const { store, job } = await deliverySetup()
  await deliver(job, store, '', async () => {
    throw new Error('Must not send')
  })
  assert.equal(
    (await store.get('DECISIONS#a', 'd')).data.delivery,
    'not_configured',
  )
})
