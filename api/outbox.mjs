import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { capabilities } from './capabilities.mjs'
import {
  subPk,
  inQuietHours,
  emailHash,
  signUnsubscribe,
} from './subscriptions.mjs'
import { subscribedAssessment, reviewTransition } from './review-alerts.mjs'
import { credentials } from './services.mjs'
export async function deliverReview(
  job,
  store,
  sender = process.env.NOTIFICATION_SENDER,
  send,
  now = Date.now(),
  secret,
) {
  if (
    job.type !== 'review.deliver' ||
    typeof job.sub !== 'string' ||
    job.sub.length > 100 ||
    !/^[a-f0-9]{32}$/.test(job.eventId || '')
  )
    throw new Error('Invalid review delivery job')
  const pk = `OUTBOX#${job.sub}`,
    row = await store.get(pk, job.eventId)
  if (!row || row.data.status !== 'pending') return
  const event = row.data
  async function state(status, extra = {}) {
    return store.replace(
      pk,
      row.sk,
      { ...event, status, ...extra },
      row.version,
      { expireAt: Math.floor(now / 1000) + 30 * 86400 },
    )
  }
  const [subscription, member] = await Promise.all([
    store.get(subPk(job.sub)),
    store.get('MEMBERS', job.sub),
  ])
  const sub = subscription?.data,
    m = member?.data
  if (
    !sub?.enabled ||
    sub.generation !== event.generation ||
    sub.workspaceId !== event.workspaceId ||
    m?.workspaceId !== event.workspaceId ||
    !m.emailVerified ||
    !['owner', 'approver', 'reviewer'].includes(m.role) ||
    emailHash(m.email) !== sub.destinationHash ||
    (await store.get(`SUPPRESSED#${sub.destinationHash}`)) ||
    event.expiresAt <= now ||
    !capabilities().reviewEmail
  ) {
    await state('suppressed')
    return
  }
  if (inQuietHours(sub, now)) return
  if (!sender) {
    await state('local_only')
    return
  }
  if (event.kind === 'review') {
    const source = await store.get(`SOURCE#${sub.area.id}`, 'forecast'),
      forecast = source?.data.value?.forecast,
      activity = sub.plan.activities.find((a) => a.id === event.activityId)
    if (!activity || forecast?.sample || forecast?.replay) {
      await state('suppressed')
      return
    }
    const current = subscribedAssessment(
      sub.plan,
      { ...activity, start: event.start, end: event.end },
      event.date,
      forecast,
      now,
    )
    if (reviewTransition(event.assessment, current).length) {
      await state('suppressed', { reason: 'evidence_changed_before_send' })
      return
    }
    const decisions = await store.list(`DECISIONS#${sub.workspaceId}`, 200)
    const chosen = decisions.find(
      (r) =>
        r.data.date === event.date &&
        r.data.activityId === event.activityId &&
        r.data.evidence?.area === sub.area.id &&
        r.data.lifecycle !== 'superseded',
    )
    if (
      chosen &&
      chosen.data.lifecycle !== 'reopened' &&
      ['rescheduled', 'shortened'].includes(chosen.data.choice) &&
      (chosen.data.proposedStart !== event.start ||
        chosen.data.proposedEnd !== event.end)
    ) {
      await state('suppressed', {
        reason: 'activity_window_changed_before_send',
      })
      return
    }
    const resolved =
      chosen &&
      chosen.data.threshold === sub.plan.threshold &&
      chosen.data.approval === 'approved' &&
      chosen.data.lifecycle !== 'reopened' &&
      !reviewTransition(chosen.data.modelAssessment, current).length
    if (resolved) {
      await state('suppressed', { reason: 'review_already_recorded' })
      return
    }
  }
  const signing = secret || (await credentials()).ALERT_SIGNING_KEY
  const token = signUnsubscribe(sub, signing, now),
    origin = process.env.ALLOWED_ORIGIN || 'http://localhost:5174'
  const link = `${origin}/?email-action=unsubscribe#token=${encodeURIComponent(token)}`
  const line = (a) =>
    `${a.activity}: ${a.start}–${a.end} IST; PM2.5 peak ${a.assessment.value ?? 'unavailable'} µg/m³; ${a.assessment.coverage} coverage; ${a.assessment.freshness} evidence.`
  const text = [
    event.kind === 'brief'
      ? `Daily brief · ${event.date} (IST)`
      : `Review needed · ${event.date} (IST)`,
    ...(event.kind === 'brief'
      ? event.activities.map(line)
      : [line(event), `Review reasons: ${event.reasons.join(', ')}`]),
    `Forecast retrieved: ${event.evidenceAt || 'unavailable'}`,
    `Prepared: ${event.preparedAt}`,
    `User planning threshold: ${sub.plan.threshold} µg/m³ PM2.5. This is regional model evidence, not a campus measurement, official AQI, safety guarantee or government order.`,
    `Stop these emails: ${link}`,
  ].join('\n')
  if (
    !(await store.increment(
      `EMAIL_QUOTA#${new Date(now).toISOString().slice(0, 10)}`,
      50,
      Math.floor(now / 1000) + 172800,
    ))
  )
    return
  // Commit unknown before SES. A worker crash or timeout cannot trigger a blind resend.
  if (
    !(await state('unknown', {
      attemptedAt: new Date(now).toISOString(),
      destinationHash: sub.destinationHash,
    }))
  )
    return
  const [lastSub, lastMember, suppression] = await Promise.all([
    store.get(subPk(job.sub)),
    store.get('MEMBERS', job.sub),
    store.get(`SUPPRESSED#${sub.destinationHash}`),
  ])
  if (
    !lastSub?.data.enabled ||
    lastSub.data.generation !== event.generation ||
    lastSub.data.workspaceId !== event.workspaceId ||
    lastMember?.data.workspaceId !== event.workspaceId ||
    !['owner', 'approver', 'reviewer'].includes(lastMember.data.role) ||
    !lastMember.data.emailVerified ||
    emailHash(lastMember.data.email) !== sub.destinationHash ||
    suppression ||
    !capabilities().reviewEmail
  ) {
    const current = await store.get(pk, row.sk)
    await store.replace(
      pk,
      row.sk,
      { ...current.data, status: 'suppressed' },
      current.version,
    )
    return
  }
  const payload = {
    FromEmailAddress: sender,
    Destination: { ToAddresses: [lastMember.data.email] },
    ...(process.env.SES_CONFIGURATION_SET
      ? { ConfigurationSetName: process.env.SES_CONFIGURATION_SET }
      : {}),
    EmailTags: [
      { Name: 'airday-owner', Value: job.sub },
      { Name: 'airday-event', Value: event.id },
      { Name: 'airday-kind', Value: 'review' },
    ],
    Content: {
      Simple: {
        Subject: {
          Data:
            event.kind === 'brief'
              ? `Airday daily brief · ${event.date}`
              : `Airday: review ${event.activity}`,
          Charset: 'UTF-8',
        },
        Body: { Text: { Data: text, Charset: 'UTF-8' } },
      },
    },
  }
  try {
    const result = await (
      send ||
      ((message) => new SESv2Client({}).send(new SendEmailCommand(message)))
    )(payload)
    const after = await store.get(pk, row.sk)
    if (after?.data.status === 'unknown')
      await store.replace(
        pk,
        row.sk,
        {
          ...after.data,
          status: 'accepted',
          messageId: result.MessageId,
          acceptedAt: new Date(now).toISOString(),
        },
        after.version,
      )
  } catch {
    console.warn(
      JSON.stringify({ event: 'review_delivery_uncertain', id: event.id }),
    )
  }
}
