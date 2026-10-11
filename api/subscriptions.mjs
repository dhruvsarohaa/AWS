import { createHmac, timingSafeEqual } from 'node:crypto'
import { ApiError, areaFor, hash, coordinates } from './core.mjs'
import { credentials } from './services.mjs'
import { capabilities } from './capabilities.mjs'
import { validateSharedPlan } from './workspaces.mjs'
export const clock = (value) =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
export const dueKey = (at, sub) => `${new Date(at).toISOString()}#${sub}`
export const subPk = (sub) => `SUBSCRIPTION#${sub}`
export const emailHash = (email) => hash(String(email).trim().toLowerCase())
export function inQuietHours(settings, now = Date.now()) {
  const time = new Date(now).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  })
  return settings.quietStart === settings.quietEnd
    ? false
    : settings.quietStart < settings.quietEnd
      ? time >= settings.quietStart && time < settings.quietEnd
      : time >= settings.quietStart || time < settings.quietEnd
}
export function signUnsubscribe(data, secret, now = Date.now()) {
  if (typeof secret !== 'string' || secret.length < 32)
    throw new ApiError('Email token signing is not configured.', 503)
  const payload = Buffer.from(
    JSON.stringify({
      sub: data.sub,
      workspaceId: data.workspaceId,
      generation: data.generation,
      exp: Math.floor(now / 1000) + 180 * 86400,
    }),
  ).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
export function verifyUnsubscribe(token, secret, now = Date.now()) {
  try {
    if (
      typeof token !== 'string' ||
      token.length > 1000 ||
      typeof secret !== 'string' ||
      secret.length < 32
    )
      throw new Error()
    const [payload, signature, ...extra] = token.split('.'),
      expected = createHmac('sha256', secret).update(payload).digest(),
      got = Buffer.from(signature || '', 'base64url')
    if (
      extra.length ||
      got.length !== expected.length ||
      !timingSafeEqual(got, expected)
    )
      throw new Error()
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (
      typeof value.sub !== 'string' ||
      value.sub.length > 100 ||
      typeof value.workspaceId !== 'string' ||
      typeof value.generation !== 'string' ||
      !Number.isSafeInteger(value.exp) ||
      value.exp < now / 1000
    )
      throw new Error()
    return value
  } catch {
    throw new ApiError('Unsubscribe link is invalid or expired.', 400)
  }
}
export async function subscriptionsRoute(method, body, member, store, secret) {
  const pk = subPk(member.sub),
    row = await store.get(pk)
  if (method === 'GET')
    return {
      subscription:
        row?.data.workspaceId === member.workspaceId ? row.data : null,
      version: row?.version || 0,
      deliveries: (await store.list(`OUTBOX#${member.sub}`, 30))
        .filter((r) => r.data.workspaceId === member.workspaceId)
        .map((r) => ({
          id: r.sk,
          kind: r.data.kind,
          date: r.data.date,
          status: r.data.status,
          preparedAt: r.data.preparedAt,
          evidenceAt: r.data.evidenceAt,
        })),
    }
  if (method !== 'PUT')
    throw new ApiError('Use GET or PUT for subscriptions.', 405)
  if (
    !Number.isSafeInteger(body.version) ||
    body.version < 0 ||
    typeof body.enabled !== 'boolean'
  )
    throw new ApiError('Subscription preference and version are required.')
  if (row && row.version !== body.version)
    throw new ApiError('Subscription changed. Reload before saving.', 409)
  let settings = null
  if (body.enabled) {
    if (!capabilities().reviewEmail)
      throw new ApiError('Scheduled email is disabled or not configured.', 503)
    if (
      !member.emailVerified ||
      typeof member.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email)
    )
      throw new ApiError('Use a verified account email destination.', 403)
    if (body.consent !== true)
      throw new ApiError(
        'Explicit consent to sync this minimal plan is required.',
      )
    const plan = validateSharedPlan(body.plan)
    if (
      !plan.activities.length ||
      plan.activities.length > 10 ||
      !coordinates(body.place?.latitude, body.place?.longitude) ||
      typeof body.place?.name !== 'string' ||
      body.place.name.length > 80 ||
      typeof body.place?.state !== 'string' ||
      body.place.state.length > 80 ||
      !clock(body.quietStart) ||
      !clock(body.quietEnd) ||
      !clock(body.briefAt) ||
      typeof body.reviewAlerts !== 'boolean' ||
      typeof body.dailyBrief !== 'boolean' ||
      (!body.reviewAlerts && !body.dailyBrief)
    )
      throw new ApiError(
        'Choose a place, up to ten activities, valid IST times and at least one email type.',
      )
    const key = secret || (await credentials()).ALERT_SIGNING_KEY
    signUnsubscribe(
      {
        sub: member.sub,
        workspaceId: member.workspaceId,
        generation: 'configuration-check',
      },
      key,
    )
    settings = {
      plan,
      area: areaFor({ ...body.place, detected: true }),
      reviewAlerts: body.reviewAlerts,
      dailyBrief: body.dailyBrief,
      quietStart: body.quietStart,
      quietEnd: body.quietEnd,
      briefAt: body.briefAt,
      timezone: 'Asia/Kolkata',
      destinationHash: emailHash(member.email),
      consentedAt: new Date().toISOString(),
    }
    if (await store.get(`SUPPRESSED#${emailHash(member.email)}`))
      throw new ApiError(
        'This destination is suppressed after a bounce or complaint.',
        409,
      )
  }
  const registry = await store.get('ALERT_REGISTRY'),
    owners = (registry?.data.owners || []).filter((sub) => sub !== member.sub)
  if (body.enabled && owners.length >= 10)
    throw new ApiError('The pilot has reached ten email subscriptions.', 429)
  if (body.enabled) owners.push(member.sub)
  const next = {
    sub: member.sub,
    workspaceId: member.workspaceId,
    enabled: body.enabled,
    generation: crypto.randomUUID(),
    ...(settings || {}),
    at: new Date().toISOString(),
    transitions: {},
    nextDue: body.enabled ? dueKey(Date.now(), member.sub) : null,
  }
  const writes = [
    { pk, sk: 'current', data: next, expected: body.version },
    { pk:`EMAIL_OWNERS#${member.workspaceId}`,sk:member.sub,data:{sub:member.sub} },
    {
      pk: 'ALERT_REGISTRY',
      sk: 'current',
      data: { owners },
      expected: registry?.version || 0,
    },
  ]
  if (row?.data.nextDue && row.data.nextDue !== next.nextDue)
    writes.push({ pk: 'DUE#REVIEWS', sk: row.data.nextDue, delete: true })
  if (next.nextDue)
    writes.push({
      pk: 'DUE#REVIEWS',
      sk: next.nextDue,
      data: { sub: member.sub, generation: next.generation },
      extra: { expireAt: Math.floor(Date.now() / 1000) + 7 * 86400 },
    })
  const at = new Date().toISOString()
  writes.push({
    pk: `AUDIT#${member.workspaceId}`,
    sk: `${at}#${crypto.randomUUID()}`,
    data: {
      at,
      actor: member.sub,
      action: 'subscription_saved',
      details: { enabled: body.enabled },
    },
  })
  if (!(await store.transaction(writes)))
    throw new ApiError(
      'Subscription admission or preference changed. Reload and retry.',
      409,
    )
  return { subscription: next, version: body.version + 1 }
}
export async function unsubscribe(token, store, secret) {
  const identity = verifyUnsubscribe(
    token,
    secret || (await credentials()).ALERT_SIGNING_KEY,
  )
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await store.get(subPk(identity.sub))
    if (!row || !row.data.enabled) return { unsubscribed: true }
    if (
      row.data.workspaceId !== identity.workspaceId ||
      row.data.generation !== identity.generation
    )
      throw new ApiError(
        'This link was replaced by newer email settings. Use the link in your latest email.',
        409,
      )
    if (await revokeSubscription(row, store, 'subscription_unsubscribed'))
      return { unsubscribed: true }
  }
  throw new ApiError('Email settings changed. Retry unsubscribe.', 409)
}
export async function revokeSubscription(
  row,
  store,
  action = 'subscription_revoked',
) {
  const registry = await store.get('ALERT_REGISTRY'),
    at = new Date().toISOString(),
    sub = row.data
  const writes = [
    {
      pk: row.pk,
      sk: row.sk,
      expected: row.version,
      data: {
        sub: sub.sub,
        workspaceId: sub.workspaceId,
        enabled: false,
        generation: crypto.randomUUID(),
        revokedAt: at,
        nextDue: null,
        transitions: {},
      },
    },
    {
      pk: 'ALERT_REGISTRY',
      sk: 'current',
      expected: registry?.version || 0,
      data: {
        owners: (registry?.data.owners || []).filter(
          (owner) => owner !== sub.sub,
        ),
      },
    },
    {
      pk: `AUDIT#${sub.workspaceId}`,
      sk: `${at}#${crypto.randomUUID()}`,
      data: { at, actor: sub.sub, action, details: { enabled: false } },
    },
  ]
  if (sub.nextDue)
    writes.push({ pk: 'DUE#REVIEWS', sk: sub.nextDue, delete: true })
  return store.transaction(writes)
}
