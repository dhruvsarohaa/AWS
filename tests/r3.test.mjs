import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore, DynamoStore } from '../api/store.mjs'
import { workspaceRoute } from '../api/workspaces.mjs'
import { groupsRoute, validateGroups } from '../api/groups.mjs'
import {
  subscriptionsRoute,
  signUnsubscribe,
  verifyUnsubscribe,
  unsubscribe,
  inQuietHours,
  emailHash,
} from '../api/subscriptions.mjs'
import { evaluateDue } from '../api/alert-dispatcher.mjs'
import { deliverReview } from '../api/outbox.mjs'
import { reconcileDelivery } from '../api/delivery-events.mjs'
import {
  publicProjection,
  publicArea,
  publicEvidence,
  widgetResponse,
} from '../api/public-evidence.mjs'
import { validateWeather, WEATHER_FIELDS } from '../api/providers/weather.mjs'
import { validateFires } from '../api/providers/fires.mjs'
import { createContext } from '../api/context.mjs'
import { validateForecast, hash } from '../api/core.mjs'
import { sharedPlan, rawForecast, place } from './fixtures.mjs'
import { planVersion } from '../src/lib/planner.ts'
import { validLocalGroups } from '../src/lib/groups.ts'
import { makeTransport } from '../api/transport.mjs'
import { deliver } from '../api/notifications.mjs'
import { validWorkspace } from '../src/lib/workspace-contract.ts'
import { validSubscriptionResponse } from '../src/lib/notification-contract.ts'
import { eraseWorkspaceEmail } from '../api/email-retention.mjs'

// These fixtures exercise offline behavior. None is imported into production.
const secret = 'synthetic-test-signing-material-only-0123456789',
  owner = {
    sub: 'owner',
    workspaceId: 'a',
    role: 'owner',
    email: 'fixture@example.test',
    emailVerified: true,
  },
  other = { ...owner, sub: 'other', workspaceId: 'b' },
  snapshot = 'a'.repeat(32)
const call = (store, member, method, path, body = {}) =>
  workspaceRoute(method, `/api/workspace${path}`, body, member, store)
async function proposalSetup() {
  const store = new MemoryStore()
  await call(store, owner, 'PUT', '/plan', { plan: sharedPlan, version: 0 })
  const forecast = validateForecast(rawForecast())
  await store.put(
    `EVIDENCE#${snapshot}`,
    'current',
    {
      date: '2030-10-08',
      area: '28.6,77.2',
      forecastId: forecast.id,
      forecastFetchedAt: forecast.fetchedAt,
      policyStatus: 'verification_needed',
      policyVersion: hash([]),
    },
    { expireAt: Date.now() / 1000 + 86400 },
  )
  await store.replace(`FORECAST#${forecast.id}`, 'current', forecast, 0)
  await store.put('SOURCE#28.6,77.2', 'forecast', { value: { forecast } })
  return {
    store,
    forecast,
    record: {
      id: 'r1',
      activityId: 'walk',
      activity: 'SYNTHETIC',
      date: '2030-10-08',
      snapshotId: snapshot,
      at: new Date().toISOString(),
      choice: 'rescheduled',
      proposedStart: '10:00',
      proposedEnd: '11:00',
      reason: 'Synthetic fixture only',
      planVersion: planVersion(sharedPlan),
    },
  }
}
function enable(t) {
  const names = {
    RELEASE_SCOPE: 'Full',
    SHARED_WORKSPACES_ENABLED: 'true',
    REVIEW_EMAIL_ENABLED: 'true',
    NOTIFICATION_SENDER: 'fixture@example.test',
    PUBLIC_EVIDENCE_ENABLED: 'true',
    PUBLIC_REDISTRIBUTION_REVIEWED: 'true',
    WEATHER_ENABLED: 'true',
    FIRES_ENABLED: 'true',
    FIRMS_PRODUCT_VERIFIED: 'true',
  }
  for (const [k, v] of Object.entries(names)) {
    const old = process.env[k]
    process.env[k] = v
    t.after(() => {
      if (old === undefined) delete process.env[k]
      else process.env[k] = old
    })
  }
}
const subscription = (version = 0) => ({
  enabled: true,
  version,
  consent: true,
  plan: sharedPlan,
  place,
  reviewAlerts: true,
  dailyBrief: true,
  quietStart: '22:00',
  quietEnd: '06:00',
  briefAt: '07:00',
})
async function emailSetup(t) {
  enable(t)
  const store = new MemoryStore()
  await store.put('MEMBERS', owner.sub, owner)
  await subscriptionsRoute('PUT', subscription(), owner, store, secret)
  return store
}

test('F15 exact proposal retry is idempotent and a different payload cannot reuse the ID', async () => {
  const { store, record } = await proposalSetup()
  const first = await call(store, owner, 'POST', '/decisions', { record })
  const again = await call(store, owner, 'POST', '/decisions', { record })
  assert.equal(first.id, again.id)
  assert.equal(again.version, 1)
  assert.equal((await store.list('AUDIT#a')).length, 2)
  await assert.rejects(
    call(store, owner, 'POST', '/decisions', {
      record: { ...record, reason: 'Different' },
    }),
    { status: 409 },
  )
})
test('F15 reopen blocks approval and replacement atomically preserves frozen history', async () => {
  const { store, record } = await proposalSetup()
  await call(store, owner, 'POST', '/decisions', { record })
  await call(store, owner, 'POST', '/decisions/r1/reopen', {
    version: 1,
    reason: 'Recheck requested',
  })
  await assert.rejects(
    call(store, owner, 'POST', '/decisions/r1/approve', { version: 2 }),
    { status: 409 },
  )
  await assert.rejects(
    call(store, other, 'POST', '/decisions/r1/reopen', {
      version: 2,
      reason: 'Cross tenant',
    }),
    { status: 404 },
  )
  const replaced = await call(store, owner, 'POST', '/decisions', {
    record: { ...record, id: 'r2' },
    supersedes: 'r1',
    version: 2,
  })
  assert.equal(replaced.replaces, 'r1')
  const old = await store.get('DECISIONS#a', 'r1')
  assert.equal(old.data.lifecycle, 'superseded')
  assert.equal(old.data.evidence.forecastId, replaced.evidence.forecastId)
  assert.equal(old.data.supersededBy, 'r2')
})
test('F15 a stale replacement version creates neither replacement nor audit', async () => {
  const { store, record } = await proposalSetup()
  await call(store, owner, 'POST', '/decisions', { record })
  const count = (await store.list('AUDIT#a')).length
  await assert.rejects(
    call(store, owner, 'POST', '/decisions', {
      record: { ...record, id: 'r2' },
      supersedes: 'r1',
      version: 999,
    }),
    { status: 409 },
  )
  assert.equal(await store.get('DECISIONS#a', 'r2'), null)
  assert.equal((await store.list('AUDIT#a')).length, count)
})
test('F15 one-off proposals use their supplied reviewed plan and do not need a shared timetable', async () => {
  const { store, record } = await proposalSetup()
  await store.delete('WORKSPACE#a', 'plan')
  const submitted = await call(store, owner, 'POST', '/decisions', {
    record: { ...record, kind: 'one_off' },
    plan: sharedPlan,
  })
  assert.equal(submitted.kind, 'one_off')
  const approved = await call(store, owner, 'POST', '/decisions/r1/approve', {
    version: 1,
  })
  assert.equal(approved.approval, 'approved')
  await assert.rejects(
    call(store, owner, 'PUT', '/decisions/r1/follow-through', {
      version: 1,
      status: 'followed',
    }),
    { status: 409 },
  )
})
test('F15 proposal location mismatch and sample evidence are rejected', async () => {
  const { store, record } = await proposalSetup()
  await assert.rejects(
    call(store, owner, 'POST', '/decisions', {
      record: { ...record, location: { areaId: '19.1,72.9' } },
    }),
    { status: 409 },
  )
  const row = await store.get(`EVIDENCE#${snapshot}`)
  await store.put(
    row.pk,
    row.sk,
    { ...row.data, sample: true },
    { expireAt: row.expireAt },
  )
  await assert.rejects(call(store, owner, 'POST', '/decisions', { record }), {
    status: 409,
  })
})
test('conditional transactions check every row before any mutation', async () => {
  const store = new MemoryStore()
  await store.replace('A', 'one', { value: 1 }, 0)
  assert.equal(
    await store.transaction([
      { pk: 'A', sk: 'two', data: { value: 2 }, expected: 0 },
      { pk: 'A', sk: 'one', data: { value: 3 }, expected: 999 },
    ]),
    false,
  )
  assert.equal(await store.get('A', 'two'), null)
  assert.equal((await store.get('A', 'one')).data.value, 1)
})
test('Dynamo transactions encode expected versions and read conditions without table scans', async () => {
  const store = new DynamoStore('synthetic')
  let input
  store.client = {
    send: async (command) => {
      input = command.input
      return {}
    },
  }
  await store.transaction([
    { pk: 'A', sk: 'one', data: {}, expected: 0 },
    { pk: 'A', sk: 'plan', check: true, expected: 2 },
  ])
  assert.equal(
    input.TransactItems[0].Put.ConditionExpression,
    'attribute_not_exists(pk)',
  )
  assert.equal(
    input.TransactItems[1].ConditionCheck.ExpressionAttributeValues[
      ':expected'
    ],
    2,
  )
})
test('F14 groups are role scoped, versioned, coarse and bounded', async () => {
  const store = new MemoryStore(),
    groups = [
      {
        id: 'g',
        name: 'Synthetic group',
        sites: [{ ...place, latitude: 28.6, longitude: 77.2 }],
      },
    ]
  await groupsRoute('PUT', { groups, version: 0 }, owner, store)
  assert.deepEqual((await groupsRoute('GET', {}, other, store)).groups, [])
  await assert.rejects(
    groupsRoute('PUT', { groups, version: 0 }, owner, store),
    { status: 409 },
  )
  await assert.rejects(
    groupsRoute(
      'PUT',
      { groups, version: 1 },
      { ...owner, role: 'reviewer' },
      store,
    ),
    { status: 403 },
  )
  assert.throws(() => validateGroups([{ ...groups[0], sites: [place] }]))
  assert.throws(() =>
    validateGroups([
      { ...groups[0], sites: Array(6).fill(groups[0].sites[0]) },
    ]),
  )
})
test('F14 local groups cannot reference missing favorites or duplicate sites', () => {
  assert.equal(
    validLocalGroups([{ id: 'g', name: 'Group', placeIds: ['missing'] }], []),
    false,
  )
  assert.equal(validLocalGroups(undefined, []), true)
})
test('F06 requires explicit sync consent and verified account destination', async (t) => {
  enable(t)
  const store = new MemoryStore()
  await assert.rejects(
    subscriptionsRoute(
      'PUT',
      { ...subscription(), consent: false },
      owner,
      store,
      secret,
    ),
    { status: 400 },
  )
  await assert.rejects(
    subscriptionsRoute(
      'PUT',
      subscription(),
      { ...owner, emailVerified: false },
      store,
      secret,
    ),
    { status: 403 },
  )
  assert.equal(await store.get('SUBSCRIPTION#owner'), null)
})
test('F06 pilot admission admits ten subscriptions and opt-out frees a slot', async (t) => {
  enable(t)
  const store = new MemoryStore()
  for (let i = 0; i < 10; i++)
    await subscriptionsRoute(
      'PUT',
      subscription(),
      { ...owner, sub: `user-${i}` },
      store,
      secret,
    )
  await assert.rejects(
    subscriptionsRoute('PUT', subscription(), other, store, secret),
    { status: 429 },
  )
  await subscriptionsRoute(
    'PUT',
    { enabled: false, version: 1 },
    { ...owner, sub: 'user-0' },
    store,
    secret,
  )
  await subscriptionsRoute('PUT', subscription(), other, store, secret)
  assert.equal((await store.get('ALERT_REGISTRY')).data.owners.length, 10)
})
test('F06 signed unsubscribe expires, rotates and works without sign-in', async (t) => {
  const store = await emailSetup(t),
    row = await store.get('SUBSCRIPTION#owner'),
    token = signUnsubscribe(row.data, secret)
  assert.equal(verifyUnsubscribe(token, secret).sub, 'owner')
  assert.throws(() => verifyUnsubscribe(`${token}tampered`, secret))
  assert.throws(() =>
    verifyUnsubscribe(token, secret, Date.now() + 181 * 86400000),
  )
  await unsubscribe(token, store, secret)
  assert.equal((await store.get('SUBSCRIPTION#owner')).data.enabled, false)
  assert.equal((await store.list('DUE#REVIEWS')).length, 0)
  await subscriptionsRoute('PUT', subscription(2), owner, store, secret)
  await assert.rejects(unsubscribe(token, store, secret), { status: 409 })
})
test('F06 quiet hours cross midnight and use IST boundaries', () => {
  const settings = { quietStart: '22:00', quietEnd: '06:00' }
  assert.equal(
    inQuietHours(settings, Date.parse('2030-10-08T22:00:00+05:30')),
    true,
  )
  assert.equal(
    inQuietHours(settings, Date.parse('2030-10-09T05:59:00+05:30')),
    true,
  )
  assert.equal(
    inQuietHours(settings, Date.parse('2030-10-09T06:00:00+05:30')),
    false,
  )
  assert.equal(
    inQuietHours({ quietStart: '00:00', quietEnd: '00:00' }, Date.now()),
    false,
  )
})
async function evaluated(t) {
  const store = await emailSetup(t)
  const now = Date.parse('2030-10-10T07:00:00+05:30'),
    forecast = {
      ...validateForecast(rawForecast()),
      fetchedAt: new Date(now).toISOString(),
      points: [{ time: '2030-10-10T08:00:00+05:30', pm25: 100, pm10: 150 }],
    }
  await store.put('SOURCE#28.6,77.2', 'forecast', { value: { forecast } })
  const engine = { dashboard: async () => ({ forecast }) },
    jobs = []
  await evaluateDue(store, engine, async (job) => jobs.push(job), now)
  return { store, now, forecast, engine, jobs }
}
test('F06 due evaluation creates one brief and one material alert, excluding exact GPS and reasons', async (t) => {
  const { store, now, engine, jobs } = await evaluated(t)
  assert.equal(jobs.length, 2)
  assert.equal((await store.list('OUTBOX#owner')).length, 2)
  await evaluateDue(store, engine, async () => {}, now + 16 * 60000)
  assert.equal((await store.list('OUTBOX#owner')).length, 2)
  const text = JSON.stringify((await store.get('SUBSCRIPTION#owner')).data)
  assert.ok(!text.includes(String(place.latitude)))
  assert.ok(!text.includes('Synthetic fixture only'))
})
test('F06 small forecast noise is deduplicated; a crossing creates a new episode', async (t) => {
  const { store, now, forecast } = await evaluated(t)
  const change = async (value, at) => {
    forecast.points[0].pm25 = value
    forecast.fetchedAt = new Date(at).toISOString()
    await evaluateDue(
      store,
      { dashboard: async () => ({ forecast }) },
      async () => {},
      at,
    )
  }
  await change(101, now + 16 * 60000)
  assert.equal((await store.list('OUTBOX#owner')).length, 2)
  await change(50, now + 32 * 60000)
  assert.equal((await store.list('OUTBOX#owner')).length, 3)
  await change(100, now + 48 * 60000)
  assert.equal((await store.list('OUTBOX#owner')).length, 4)
})
test('F06 delivery is accepted once, provider feedback confirms delivery then complaint suppresses recipient', async (t) => {
  const { store, jobs, now } = await evaluated(t)
  let sent = 0,
    payload
  const job = jobs.find((j) => j.type === 'review.deliver')
  await deliverReview(
    job,
    store,
    'fixture@example.test',
    async (p) => {
      sent++
      payload = p
      return { MessageId: 'synthetic-message' }
    },
    now,
    secret,
  )
  await deliverReview(
    job,
    store,
    'fixture@example.test',
    async () => {
      sent++
    },
    now,
    secret,
  )
  assert.equal(sent, 1)
  assert.ok(payload.Content.Simple.Body.Text.Data.includes('Confirm') === false)
  assert.ok(
    payload.Content.Simple.Body.Text.Data.includes('email-action=unsubscribe'),
  )
  assert.equal(
    (await store.get('OUTBOX#owner', job.eventId)).data.status,
    'accepted',
  )
  const detail = {
    eventType: 'Delivery',
    mail: {
      messageId: 'synthetic-message',
      destination: [owner.email],
      tags: {
        'airday-owner': [owner.sub],
        'airday-event': [job.eventId],
        'airday-kind': ['review'],
      },
    },
  }
  await reconcileDelivery(detail, store)
  assert.equal(
    (await store.get('OUTBOX#owner', job.eventId)).data.status,
    'delivered',
  )
  await reconcileDelivery({ ...detail, eventType: 'Complaint' }, store)
  assert.ok(await store.get(`SUPPRESSED#${emailHash(owner.email)}`))
  await reconcileDelivery(detail, store)
  assert.equal(
    (await store.get('OUTBOX#owner', job.eventId)).data.status,
    'suppressed',
  )
})
test('F06 SES uncertainty is never blindly retried', async (t) => {
  const { store, jobs, now } = await evaluated(t)
  let calls = 0
  await deliverReview(
    jobs[0],
    store,
    'fixture@example.test',
    async () => {
      calls++
      throw new Error('Synthetic timeout')
    },
    now,
    secret,
  )
  await deliverReview(
    jobs[0],
    store,
    'fixture@example.test',
    async () => {
      calls++
    },
    now,
    secret,
  )
  assert.equal(calls, 1)
  assert.equal(
    (await store.get('OUTBOX#owner', jobs[0].eventId)).data.status,
    'unknown',
  )
})
test('F06 opt-out before delivery suppresses queued work', async (t) => {
  const { store, jobs, now } = await evaluated(t),
    row = await store.get('SUBSCRIPTION#owner')
  await subscriptionsRoute(
    'PUT',
    { enabled: false, version: row.version },
    owner,
    store,
    secret,
  )
  let sent = 0
  await deliverReview(
    jobs[0],
    store,
    'fixture@example.test',
    async () => {
      sent++
    },
    now,
    secret,
  )
  assert.equal(sent, 0)
  assert.equal(
    (await store.get('OUTBOX#owner', jobs[0].eventId)).data.status,
    'suppressed',
  )
})
test('F06 local evaluator does not claim email was sent', async (t) => {
  const { store, jobs, now } = await evaluated(t)
  await deliverReview(
    jobs[0],
    store,
    '',
    async () => {
      throw new Error('Must not send')
    },
    now,
    secret,
  )
  assert.equal(
    (await store.get('OUTBOX#owner', jobs[0].eventId)).data.status,
    'local_only',
  )
})
test('F06 sample/replay dashboards do not create live outbox entries', async (t) => {
  const store = await emailSetup(t)
  await evaluateDue(
    store,
    { dashboard: async () => ({ sample: true }) },
    async () => {
      throw new Error('Must not enqueue')
    },
  )
  assert.equal((await store.list('OUTBOX#owner')).length, 0)
})
function publicFixture() {
  return {
    location: { ...place, email: 'PRIVATE', reason: 'PRIVATE' },
    forecast: validateForecast(rawForecast()),
    monitors: [],
    nearbyMonitors: [],
    sources: {
      forecast: { status: 'live', message: 'PRIVATE' },
      openaq: { status: 'not_configured' },
      cpcb: { status: 'unverified' },
    },
    membership: 'PRIVATE',
    plan: 'PRIVATE',
    journal: 'PRIVATE',
    policy: 'PRIVATE',
  }
}
test('F13/F22 public projection allowlists every nested field', () => {
  const data = publicProjection(publicFixture(), '2030-10-08')
  assert.ok(!JSON.stringify(data).includes('PRIVATE'))
  assert.equal(data.area.latitude, 28.6)
  assert.equal(data.forecast.points.length, 3)
  assert.throws(() =>
    publicProjection({ ...publicFixture(), replay: true }, '2030-10-08'),
  )
})
test('F22 public parameters are coarse and cannot select an upstream URL or tenant', async (t) => {
  enable(t)
  assert.throws(() =>
    publicArea(new URLSearchParams({ area: '28.6139,77.209' })),
  )
  await assert.rejects(
    publicEvidence(
      new URLSearchParams({ area: '28.6,77.2', tenant: 'private' }),
      {},
      new MemoryStore(),
    ),
    { status: 400 },
  )
})
test('F22 widget escapes names and has explicit frame origins while scripts are disabled', (t) => {
  const old = process.env.PUBLIC_EMBED_ORIGINS
  process.env.PUBLIC_EMBED_ORIGINS = 'https://example.test'
  t.after(() => {
    if (old === undefined) delete process.env.PUBLIC_EMBED_ORIGINS
    else process.env.PUBLIC_EMBED_ORIGINS = old
  })
  const data = publicProjection(publicFixture(), '2030-10-08')
  data.observations = [
    {
      station: '<script>alert(1)</script>',
      source: 'OpenAQ',
      value: 1,
      observedAt: null,
      statistic: null,
      period: null,
      qualityFlags: [],
      stale: true,
    },
  ]
  const output = widgetResponse(data)
  assert.ok(!output.body.includes('<script>'))
  assert.ok(output.body.includes('&lt;script&gt;'))
  assert.ok(
    output.headers['content-security-policy'].includes(
      'frame-ancestors https://example.test',
    ),
  )
  assert.ok(
    output.headers['content-security-policy'].includes("default-src 'none'"),
  )
})
function rawWeather() {
  return {
    timezone: 'GMT',
    utc_offset_seconds: 0,
    latitude: 28.6,
    longitude: 77.2,
    hourly_units: Object.fromEntries(
      Object.entries(WEATHER_FIELDS).map(([key, [, unit]]) => [key, unit]),
    ),
    hourly: {
      time: ['2030-10-10T08:00', '2030-10-10T09:00'],
      temperature_2m: [30, null],
      apparent_temperature: [33, 32],
      relative_humidity_2m: [50, 55],
      precipitation: [0, null],
      wind_speed_10m: [0, 3],
      wind_direction_10m: [0, 90],
    },
  }
}
test('F23 weather preserves zero/null and independent unit/interval metadata', () => {
  const value = validateWeather(
    rawWeather(),
    Date.parse('2030-10-10T07:00:00Z'),
  )
  assert.equal(value.points[0].windSpeed, 0)
  assert.equal(value.points[1].temperature, null)
  assert.equal(value.fields.precipitation.statistic, 'preceding_hour_total')
  assert.equal(value.points[0].time, '2030-10-10T08:00:00.000Z')
  const bad = rawWeather()
  bad.hourly_units.wind_speed_10m = 'km/h'
  assert.throws(() => validateWeather(bad))
  const malformed = rawWeather()
  malformed.hourly.precipitation = [0]
  assert.throws(() => validateWeather(malformed))
})
const csv =
  'latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp\n28.6,77.2,2030-10-10,0630,N20,VIIRS,n,0\n28.6,77.2,2030-10-10,0630,N20,VIIRS,n,0\n'
test('F24 validates UTC acquisition/product, deduplicates and retains no-detection meaning', () => {
  const value = validateFires(
    csv,
    { latitude: 28.6, longitude: 77.2 },
    Date.parse('2030-10-10T07:00:00Z'),
  )
  assert.equal(value.detections.length, 1)
  assert.equal(value.detections[0].acquiredAt, '2030-10-10T06:30:00.000Z')
  assert.equal(value.detections[0].fireRadiativePower, 0)
  assert.equal(value.detections[0].confidence, 'nominal')
  assert.throws(() =>
    validateFires(
      csv.replaceAll('0630', '2500'),
      { latitude: 28.6, longitude: 77.2 },
      Date.parse('2030-10-10T07:00:00Z'),
    ),
  )
  assert.throws(() =>
    validateFires(
      csv,
      { latitude: 28.6, longitude: 77.2 },
      Date.parse('2030-10-10T07:00:00Z'),
      'unverified',
    ),
  )
  assert.equal(
    validateFires(csv.split('\n')[0], { latitude: 28.6, longitude: 77.2 })
      .detections.length,
    0,
  )
})
test('F23/F24 context failure retains previous data and never mutates air evidence', async (t) => {
  enable(t)
  const store = new MemoryStore(),
    area = { id: '28.6,77.2', latitude: 28.6, longitude: 77.2 }
  await store.put('DEMAND', area.id, area, {
    expireAt: Date.now() / 1000 + 86400,
  })
  await store.put(`CONTEXT#${area.id}`, 'weather', {
    value: { fetchedAt: '2030-10-10T07:00:00Z', points: [] },
    status: 'available',
  })
  await store.put(`SOURCE#${area.id}`, 'forecast', {
    value: { id: 'air-unchanged' },
  })
  const context = createContext({
    store,
    request: async () => {
      throw new Error('Synthetic provider failure')
    },
    keys: async () => ({}),
    engine: {},
    enqueue: async () => {},
    archive: async () => {},
  })
  await context.refresh({ type: 'context.refresh', area, family: 'weather' })
  const retained = await store.get(`CONTEXT#${area.id}`, 'weather')
  assert.equal(retained.data.status, 'unavailable')
  assert.equal(retained.data.value.fetchedAt, '2030-10-10T07:00:00Z')
  assert.equal(
    (await store.get(`SOURCE#${area.id}`, 'forecast')).data.value.id,
    'air-unchanged',
  )
})
test('context transport enforces its provider host and rejects redirects before any fetch', async () => {
  let calls = 0
  const request = makeTransport(new MemoryStore(), async () => {
    calls++
    throw new Error('Must not fetch')
  })
  await assert.rejects(
    request('firms', 'https://api.open-meteo.com/v1/forecast'),
  )
  await assert.rejects(request('weather', 'https://example.test'))
  assert.equal(calls, 0)
})

test('F15 a committed proposal can be recovered after evidence expires or the plan changes', async () => {
  const { store, record } = await proposalSetup()
  await call(store, owner, 'POST', '/decisions', { record })
  await store.delete(`EVIDENCE#${snapshot}`)
  await store.delete('WORKSPACE#a', 'plan')
  assert.equal(
    (await call(store, owner, 'POST', '/decisions', { record })).version,
    1,
  )
})
test('F15 a plan race at proposal commit leaves no proposal or audit', async () => {
  const { store, record } = await proposalSetup(),
    transact = store.transaction.bind(store)
  store.transaction = async (writes) => {
    const row = await store.get('WORKSPACE#a', 'plan')
    await store.replace(
      row.pk,
      row.sk,
      { ...row.data, threshold: 76 },
      row.version,
    )
    return transact(writes)
  }
  await assert.rejects(call(store, owner, 'POST', '/decisions', { record }), {
    status: 409,
  })
  assert.equal(await store.get('DECISIONS#a', 'r1'), null)
  assert.equal((await store.list('AUDIT#a')).length, 1)
})
test('durable transaction failure blocks reads and further mutations until recovery', async () => {
  const store = new MemoryStore()
  store.flush = async () => {
    throw new Error('Synthetic disk failure')
  }
  await assert.rejects(
    store.transaction([
      { pk: 'A', sk: 'one', data: { value: 1 }, expected: 0 },
    ]),
  )
  await assert.rejects(store.get('A', 'one'))
  await assert.rejects(store.list('A'))
  await assert.rejects(store.range('A', '', 'z'))
  await assert.rejects(store.put('B', 'two', {}))
  assert.equal(store.rows.has('B|two'), false)
})
test('F15 client rejects malformed nested workspace data while accepting a server projection', async () => {
  const { store, record } = await proposalSetup()
  await call(store, owner, 'POST', '/decisions', { record })
  const w = await call(store, { ...owner, notifications: false }, 'GET', '')
  assert.equal(validWorkspace(w), true)
  assert.equal(
    validWorkspace({
      ...w,
      decisions: [{ ...w.decisions[0], activityWindow: null }],
    }),
    false,
  )
  assert.equal(
    validWorkspace({
      ...w,
      groups: [{ id: 'g', name: 'Group', sites: [null] }],
    }),
    false,
  )
})
test('F06 client rejects malformed enabled settings and delivery states', async (t) => {
  const store = await emailSetup(t),
    r = await subscriptionsRoute('GET', {}, owner, store, secret)
  assert.equal(validSubscriptionResponse(r), true)
  assert.equal(
    validSubscriptionResponse({
      ...r,
      subscription: { enabled: true, plan: sharedPlan, quietStart: 'bad' },
    }),
    false,
  )
  assert.equal(
    validSubscriptionResponse({
      ...r,
      deliveries: [
        {
          id: 'x',
          kind: 'brief',
          date: '2030-10-10',
          status: 'sent',
          evidenceAt: null,
        },
      ],
    }),
    false,
  )
})
test('F06 a rescheduled later window remains eligible after the original activity ends', async (t) => {
  const store = await emailSetup(t),
    now = Date.parse('2030-10-10T09:30:00+05:30'),
    forecast = {
      ...validateForecast(rawForecast()),
      fetchedAt: new Date(now).toISOString(),
      points: [{ time: '2030-10-10T10:00:00+05:30', pm25: 100, pm10: 150 }],
    }
  await store.replace(
    'DECISIONS#a',
    'later',
    {
      id: 'later',
      at: new Date(now).toISOString(),
      date: '2030-10-10',
      activityId: 'walk',
      evidence: { area: '28.6,77.2' },
      choice: 'rescheduled',
      proposedStart: '10:00',
      proposedEnd: '11:00',
      approval: 'pending',
      lifecycle: 'recorded',
    },
    0,
  )
  await evaluateDue(
    store,
    { dashboard: async () => ({ forecast }) },
    async () => {},
    now,
  )
  const event = (await store.list('OUTBOX#owner')).find(
    (r) => r.data.kind === 'review',
  )
  assert.equal(event.data.start, '10:00')
  assert.equal(event.data.assessment.value, 100)
})
test('F06 an older approval cannot suppress review for a newer pending proposal', async (t) => {
  const { store, jobs, now } = await evaluated(t),
    job = jobs.find(
      (j) => store.rows.get(`OUTBOX#owner|${j.eventId}`).data.kind === 'review',
    ),
    event = (await store.get('OUTBOX#owner', job.eventId)).data
  for (const [id, at, approval] of [
    ['old', '2030-10-09T00:00:00Z', 'approved'],
    ['new', '2030-10-10T00:00:00Z', 'pending'],
  ])
    await store.replace(
      'DECISIONS#a',
      id,
      {
        id,
        at,
        approval,
        date: event.date,
        activityId: event.activityId,
        evidence: { area: '28.6,77.2' },
        threshold: sharedPlan.threshold,
        modelAssessment: event.assessment,
        lifecycle: 'recorded',
      },
      0,
    )
  let sends = 0
  await deliverReview(
    job,
    store,
    'fixture@example.test',
    async () => {
      sends++
      return { MessageId: 'synthetic' }
    },
    now,
    secret,
  )
  assert.equal(sends, 1)
})
test('F06 provider feedback cannot be applied to a different destination', async (t) => {
  const { store, jobs, now } = await evaluated(t),
    job = jobs[0]
  await deliverReview(
    job,
    store,
    'fixture@example.test',
    async () => ({ MessageId: 'synthetic' }),
    now,
    secret,
  )
  await reconcileDelivery(
    {
      eventType: 'Complaint',
      mail: {
        messageId: 'synthetic',
        destination: ['different@example.test'],
        tags: {
          'airday-owner': ['owner'],
          'airday-event': [job.eventId],
          'airday-kind': ['review'],
        },
      },
    },
    store,
  )
  assert.equal(
    (await store.get('OUTBOX#owner', job.eventId)).data.status,
    'accepted',
  )
  assert.equal(
    await store.get(`SUPPRESSED#${emailHash('different@example.test')}`),
    null,
  )
})
async function approvalDeliverySetup() {
  const store = new MemoryStore(),
    job = {
      type: 'notification',
      workspaceId: 'a',
      decisionId: 'd',
      recipientSub: 'owner',
    }
  await store.put('MEMBERS', 'owner', owner)
  await store.put('PREFERENCES#owner', 'current', { enabled: true })
  await store.replace(
    'DECISIONS#a',
    'd',
    {
      approval: 'approved',
      delivery: 'queued',
      activity: 'SYNTHETIC',
      choice: 'indoors',
      date: '2030-10-10',
      reason: 'Synthetic',
      snapshotId: snapshot,
      approvedAt: new Date().toISOString(),
    },
    0,
  )
  return { store, job }
}
test('F06 approval delivery checks consent again immediately before the external send', async () => {
  const { store, job } = await approvalDeliverySetup(),
    replace = store.replace.bind(store)
  store.replace = async (...args) => {
    const saved = await replace(...args)
    if (args[2]?.delivery === 'delivery_unknown')
      await store.put('PREFERENCES#owner', 'current', { enabled: false })
    return saved
  }
  let sends = 0
  await deliver(job, store, 'fixture@example.test', async () => {
    sends++
  })
  assert.equal(sends, 0)
  assert.equal(
    (await store.get('DECISIONS#a', 'd')).data.delivery,
    'suppressed',
  )
})
test('F06 a completed send cannot reactivate a concurrently reopened proposal', async () => {
  const { store, job } = await approvalDeliverySetup()
  await deliver(job, store, 'fixture@example.test', async () => {
    const r = await store.get('DECISIONS#a', 'd')
    await store.replace(
      r.pk,
      r.sk,
      {
        ...r.data,
        approval: 'reopened',
        lifecycle: 'reopened',
        delivery: 'suppressed',
      },
      r.version,
    )
    return { MessageId: 'synthetic' }
  })
  assert.equal(
    (await store.get('DECISIONS#a', 'd')).data.delivery,
    'suppressed',
  )
})
test('F23 rejects future horizon drift and non-hourly weather time metadata', () => {
  const now = Date.parse('2030-10-10T07:00:00Z'),
    raw = rawWeather()
  raw.hourly.time = ['2030-11-10T08:00', '2030-11-10T09:00']
  assert.throws(() => validateWeather(raw, now))
  raw.hourly.time = ['2030-10-10T08:30', '2030-10-10T09:30']
  assert.throws(() => validateWeather(raw, now))
})
test('F24 missing FIRMS credentials is distinct from no detections and malformed jobs are rejected', async (t) => {
  enable(t)
  const store = new MemoryStore(),
    area = { id: '28.6,77.2', latitude: 28.6, longitude: 77.2 }
  await store.put('DEMAND', area.id, area, {
    expireAt: Date.now() / 1000 + 86400,
  })
  const context = createContext({
    store,
    request: async () => {
      throw new Error('Must not fetch')
    },
    keys: async () => ({}),
    engine: {},
    enqueue: async () => {},
    archive: async () => {},
  })
  await context.refresh({ type: 'context.refresh', area, family: 'fires' })
  assert.equal(
    (await store.get(`CONTEXT#${area.id}`, 'fires')).data.status,
    'not_configured',
  )
  await assert.rejects(
    context.refresh({
      type: 'context.refresh',
      area: { id: 'NaN,NaN', latitude: NaN, longitude: NaN },
      family: 'weather',
    }),
  )
})
test('F06 evaluation failure defers only its subscription and does not starve pending delivery', async (t) => {
  const { store, now } = await evaluated(t),
    jobs = []
  await evaluateDue(
    store,
    {
      dashboard: async () => {
        throw new Error('Synthetic area admission failure')
      },
    },
    async (job) => jobs.push(job),
    now + 16 * 60000,
  )
  assert.equal(jobs.length, 2)
  const row = await store.get('SUBSCRIPTION#owner')
  assert.equal(row.data.evaluationStatus, 'unavailable')
  assert.equal((await store.list('DUE#REVIEWS')).length, 1)
})
test('F06 membership revocation stops evaluation and releases subscription admission', async (t) => {
  const store = await emailSetup(t)
  await store.delete('MEMBERS', 'owner')
  await evaluateDue(
    store,
    {
      dashboard: async () => {
        throw new Error('Must not evaluate a revoked plan')
      },
    },
    async () => {
      throw new Error('Must not enqueue')
    },
  )
  const row = await store.get('SUBSCRIPTION#owner')
  assert.equal(row.data.enabled, false)
  assert.equal(row.data.plan, undefined)
  assert.deepEqual((await store.get('ALERT_REGISTRY')).data.owners, [])
  assert.equal((await store.list('DUE#REVIEWS')).length, 0)
})
test('F06 unsubscribe removes synced plan and area while retaining an audit receipt', async (t) => {
  const store = await emailSetup(t),
    row = await store.get('SUBSCRIPTION#owner')
  await unsubscribe(signUnsubscribe(row.data, secret), store, secret)
  const disabled = (await store.get(row.pk, row.sk)).data
  assert.equal(disabled.plan, undefined)
  assert.equal(disabled.area, undefined)
  assert.ok(
    (await store.list('AUDIT#a')).some(
      (r) => r.data.action === 'subscription_unsubscribed',
    ),
  )
})
test('F06 workspace erasure finds receipts after membership moves and preserves another workspace', async (t) => {
  const store = await emailSetup(t)
  await store.put('OUTBOX#owner', 'old', {
    workspaceId: 'a',
    status: 'accepted',
  })
  await store.put('OUTBOX#owner', 'other', {
    workspaceId: 'b',
    status: 'accepted',
  })
  const row = await store.get('SUBSCRIPTION#owner')
  await subscriptionsRoute(
    'PUT',
    { ...subscription(row.version) },
    { ...owner, workspaceId: 'b' },
    store,
    secret,
  )
  assert.equal(await eraseWorkspaceEmail('a', store), 1)
  assert.equal(await store.get('OUTBOX#owner', 'old'), null)
  assert.ok(await store.get('OUTBOX#owner', 'other'))
  assert.equal((await store.get('SUBSCRIPTION#owner')).data.workspaceId, 'b')
})
test('F06 workspace erasure removes its synced plan and frees pilot quota', async (t) => {
  const store = await emailSetup(t)
  await eraseWorkspaceEmail('a', store)
  assert.equal(await store.get('SUBSCRIPTION#owner'), null)
  assert.deepEqual((await store.get('ALERT_REGISTRY')).data.owners, [])
  assert.equal((await store.list('DUE#REVIEWS')).length, 0)
})
