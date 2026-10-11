import { hash } from './core.mjs'
import { capabilities } from './capabilities.mjs'
import {
  subPk,
  dueKey,
  inQuietHours,
  emailHash,
  revokeSubscription,
} from './subscriptions.mjs'
import {
  subscribedAssessment,
  reviewTransition,
  activityEvent,
} from './review-alerts.mjs'
import { runtime } from './runtime.mjs'
import { enqueue } from './services.mjs'
export async function evaluateDue(
  store,
  engine,
  queue = enqueue,
  now = Date.now(),
) {
  if (!capabilities().reviewEmail) return
  const page = await store.range(
    'DUE#REVIEWS',
    '',
    `${new Date(now).toISOString()}~`,
    10,
  )
  for (const due of page.rows) {
    if (!(await store.claim(`EVALUATE#${due.data.sub}`, 90, now))) continue
    const row = await store.get(subPk(due.data.sub)),
      sub = row?.data
    if (
      !sub?.enabled ||
      sub.nextDue !== due.sk ||
      sub.generation !== due.data.generation
    ) {
      await store.delete(due.pk, due.sk)
      continue
    }
    try {
      const member = (await store.get('MEMBERS', sub.sub))?.data
      if (
        !member ||
        member.workspaceId !== sub.workspaceId ||
        !member.emailVerified ||
        !['owner', 'approver', 'reviewer'].includes(member.role) ||
        emailHash(member.email) !== sub.destinationHash ||
        (await store.get(`SUPPRESSED#${sub.destinationHash}`))
      ) {
        await revokeSubscription(row, store)
        continue
      }
      const date = new Date(now).toLocaleDateString('sv-SE', {
          timeZone: 'Asia/Kolkata',
        }),
        day = new Date(`${date}T12:00:00+05:30`).getUTCDay()
      // Renew only explicitly synced demand, using the same twenty-area admission path.
      const place = {
        name: 'Subscribed area',
        state: '',
        country: 'India',
        latitude: sub.area.latitude,
        longitude: sub.area.longitude,
        detected: true,
      }
      const dashboard = await engine.dashboard(place, date),
        forecast = dashboard.forecast
      if (
        dashboard.sample ||
        dashboard.replay ||
        dashboard.fixtures ||
        forecast?.sample ||
        forecast?.replay
      )
        continue
      const decisions = (
        await store.list(`DECISIONS#${sub.workspaceId}`, 200)
      ).filter(
        (r) =>
          r.data.date === date &&
          r.data.evidence?.area === sub.area.id &&
          r.data.lifecycle !== 'superseded',
      )
      const transitions = { ...sub.transitions },
        events = [],
        brief = []
      for (const activity of sub.plan.activities.filter((a) =>
        a.days.includes(day),
      )) {
        const chosen = decisions.find((r) => r.data.activityId === activity.id)
        const effective =
          chosen &&
          chosen.data.lifecycle !== 'reopened' &&
          ['rescheduled', 'shortened'].includes(chosen.data.choice)
            ? {
                ...activity,
                start: chosen.data.proposedStart,
                end: chosen.data.proposedEnd,
              }
            : activity
        if (Date.parse(`${date}T${effective.end}:00+05:30`) <= now) continue
        const current = subscribedAssessment(
            sub.plan,
            effective,
            date,
            forecast,
            now,
          ),
          key = `${date}#${activity.id}`,
          previous = transitions[key]
        const resolved =
          chosen &&
          chosen.data.approval === 'approved' &&
          chosen.data.lifecycle !== 'reopened' &&
          chosen.data.threshold === sub.plan.threshold &&
          !reviewTransition(chosen.data.modelAssessment, current).length
        const reasons = reviewTransition(previous?.assessment, current),
          episode = (previous?.episode || 0) + (reasons.length ? 1 : 0)
        transitions[key] = { assessment: current, episode }
        if (sub.reviewAlerts && reasons.length && !resolved)
          events.push(
            activityEvent(
              sub,
              effective,
              date,
              current,
              episode,
              reasons,
              forecast,
              now,
            ),
          )
        brief.push({
          activity: effective.activity,
          start: effective.start,
          end: effective.end,
          assessment: current,
        })
      }
      const time = new Date(now).toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
      })
      const briefDue =
        sub.dailyBrief &&
        sub.briefDate !== date &&
        time >= sub.briefAt &&
        !inQuietHours(sub, now)
      if (briefDue)
        events.push({
          id: hash([sub.sub, sub.generation, 'brief', date]),
          sub: sub.sub,
          workspaceId: sub.workspaceId,
          generation: sub.generation,
          kind: 'brief',
          date,
          activities: brief,
          evidenceAt: forecast?.fetchedAt || null,
          status: 'pending',
          preparedAt: new Date(now).toISOString(),
          expiresAt: Date.parse(`${date}T23:59:59+05:30`),
        })
      const nextDue = dueKey(now + 15 * 60000, sub.sub),
        writes = [
          {
            pk: row.pk,
            sk: row.sk,
            data: {
              ...sub,
              nextDue,
              lastEvaluationAt: new Date(now).toISOString(),
              evaluationStatus: 'evaluated',
              lastEvaluationError: null,
              transitions: Object.fromEntries(
                Object.entries(transitions).filter(([key]) =>
                  key.startsWith(date),
                ),
              ),
              ...(briefDue ? { briefDate: date } : {}),
            },
            expected: row.version,
          },
          { pk: due.pk, sk: due.sk, delete: true },
          {
            pk: 'DUE#REVIEWS',
            sk: nextDue,
            data: { sub: sub.sub, generation: sub.generation },
            extra: { expireAt: Math.floor(now / 1000) + 7 * 86400 },
          },
        ]
      for (const event of events)
        writes.push(
          {
            pk: `OUTBOX#${sub.sub}`,
            sk: event.id,
            data: event,
            expected: 0,
            extra: { expireAt: Math.floor(now / 1000) + 30 * 86400 },
          },
          {
            pk: 'DUE#OUTBOX',
            sk: dueKey(now, `${sub.sub}#${event.id}`),
            data: { sub: sub.sub, id: event.id },
            extra: { expireAt: Math.floor(now / 1000) + 2 * 86400 },
          },
        )
      if (!(await store.transaction(writes))) continue
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'subscription_evaluation_failed',
          status: error.status || 503,
        }),
      )
      const current = await store.get(row.pk, row.sk)
      if (!current?.data.enabled || current.version !== row.version) continue
      const nextDue = dueKey(now + 5 * 60000, sub.sub)
      await store.transaction([
        {
          pk: row.pk,
          sk: row.sk,
          expected: row.version,
          data: {
            ...sub,
            nextDue,
            lastEvaluationAt: new Date(now).toISOString(),
            evaluationStatus: 'unavailable',
            lastEvaluationError:
              'Evaluation failed; delivery waits for a new assessment.',
          },
        },
        { pk: due.pk, sk: due.sk, delete: true },
        {
          pk: 'DUE#REVIEWS',
          sk: nextDue,
          data: { sub: sub.sub, generation: sub.generation },
          extra: { expireAt: Math.floor(now / 1000) + 7 * 86400 },
        },
      ])
    }
  }
  const outbox = await store.range(
    'DUE#OUTBOX',
    '',
    `${new Date(now).toISOString()}~`,
    50,
  )
  for (const due of outbox.rows) {
    const event = await store.get(`OUTBOX#${due.data.sub}`, due.data.id)
    if (!event || event.data.status !== 'pending') {
      await store.delete(due.pk, due.sk)
      continue
    }
    if (!(await store.claim(`OUTBOX_QUEUE#${event.sk}`, 60, now))) continue
    try {
      await queue(
        { type: 'review.deliver', sub: due.data.sub, eventId: due.data.id },
        true,
      )
    } catch {
      console.warn(JSON.stringify({ event: 'review_queue_unavailable' }))
    }
  }
}
export async function handler() {
  const { store, engine } = await runtime()
  await evaluateDue(store, engine)
  return { ok: true }
}
