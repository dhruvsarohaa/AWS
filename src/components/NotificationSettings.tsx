import { useEffect, useRef, useState } from 'react'
import type { OutdoorPlan, Place } from '../types.ts'
import { captureSession, onSessionEnd, workspaceRequest } from '../lib/auth.ts'
import { createRequestScope } from '../lib/requestScope.ts'
import { validSubscriptionResponse } from '../lib/notification-contract.ts'
import type { SubscriptionResponse as Response } from '../lib/notification-contract.ts'
export default function NotificationSettings({
  plan,
  place,
  configured,
}: {
  plan: OutdoorPlan
  place?: Place
  configured: boolean
}) {
  const [value, setValue] = useState<Response | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [review, setReview] = useState(true),
    [brief, setBrief] = useState(false),
    [quietStart, setQuietStart] = useState('22:00'),
    [quietEnd, setQuietEnd] = useState('06:00'),
    [briefAt, setBriefAt] = useState('07:00'),
    [reloadRequired, setReloadRequired] = useState(false)
  const scope = useRef(createRequestScope())
  async function load(signal?: AbortSignal) {
    const r = await workspaceRequest('/subscriptions', 'GET', undefined, signal)
    if (!validSubscriptionResponse(r))
      throw new Error('Unsupported subscription response.')
    return r
  }
  useEffect(() => {
    const current = scope.current,
      request = current.capture(),
      session = captureSession(),
      off = onSessionEnd(() => {
        current.invalidate()
        setValue(null)
        setError('')
        setNotice('')
        setConsent(false)
      })
    void load(request.signal)
      .then((r) => {
        if (request.isCurrent() && session.isCurrent()) {
          setValue(r)
          if (r.subscription) {
            setReview(r.subscription.reviewAlerts ?? true)
            setBrief(r.subscription.dailyBrief ?? false)
            setQuietStart(r.subscription.quietStart || '22:00')
            setQuietEnd(r.subscription.quietEnd || '06:00')
            setBriefAt(r.subscription.briefAt || '07:00')
          }
        }
      })
      .catch((e) => {
        if (request.isCurrent() && session.isCurrent()) setError(e.message)
      })
    return () => {
      off()
      current.invalidate()
    }
  }, [])
  async function save(enabled: boolean) {
    if (!value) return
    const request = scope.current.capture(),
      session = captureSession()
    setBusy(true)
    setError('')
    setNotice('')
    let committed = false
    try {
      const r = await workspaceRequest(
        '/subscriptions',
        'PUT',
        {
          enabled,
          version: value.version,
          consent,
          plan,
          place,
          reviewAlerts: review,
          dailyBrief: brief,
          quietStart,
          quietEnd,
          briefAt,
        },
        request.signal,
      )
      committed = true
      if (!request.isCurrent() || !session.isCurrent()) return
      setValue((v) =>
        v ? { ...v, subscription: r.subscription, version: r.version } : v,
      )
      setConsent(false)
      setNotice(
        enabled
          ? 'Email settings saved with the selected plan and coarse area.'
          : 'Scheduled email disabled.',
      )
      const fresh = await load(request.signal)
      if (request.isCurrent() && session.isCurrent()) {
        setValue(fresh)
        setReloadRequired(false)
      }
    } catch (e) {
      if (request.isCurrent() && session.isCurrent()) {
        setReloadRequired(true)
        setError(
          committed
            ? 'Saved; refresh failed. Reload these settings before changing them again.'
            : e instanceof Error
              ? e.message
              : 'Request failed.',
        )
      }
    } finally {
      if (request.isCurrent() && session.isCurrent()) setBusy(false)
    }
  }
  return (
    <section className="notification-settings">
      <h3>Scheduled review emails & daily brief</h3>
      <p className="help-text">
        Email uses your verified account destination. Enabling explicitly
        uploads this plan, its threshold and the selected coarse area for
        closed-tab scheduling. Private decision reasons and exact detected GPS
        are excluded. Up to ten subscriptions and fifty emails per UTC day
        across this pilot. Equal quiet-hour times disable quiet hours.
      </p>
      {!configured && (
        <p>Scheduled delivery is disabled or awaiting server configuration.</p>
      )}
      {!value && !error && (
        <p role="status">Loading email settings and delivery history…</p>
      )}
      {value?.subscription && (
        <p>
          Current subscription:{' '}
          {value.subscription.enabled ? 'enabled' : 'disabled'} · synced plan:{' '}
          {value.subscription.plan?.name || 'none'}
          {value.subscription.evaluationStatus && (
            <>
              {' '}
              · evaluation: {value.subscription.evaluationStatus} at{' '}
              {value.subscription.lastEvaluationAt} ·{' '}
              {value.subscription.lastEvaluationError}
            </>
          )}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(true)
        }}
      >
        <label className="radio-option">
          <input
            type="checkbox"
            checked={review}
            disabled={busy}
            onChange={(e) => setReview(e.target.checked)}
          />
          Material-change review alerts
        </label>
        <label className="radio-option">
          <input
            type="checkbox"
            checked={brief}
            disabled={busy}
            onChange={(e) => setBrief(e.target.checked)}
          />
          Daily brief
        </label>
        <div className="r2-form-row">
          <label>
            Quiet hours start · IST
            <input
              type="time"
              required
              value={quietStart}
              disabled={busy}
              onChange={(e) => setQuietStart(e.target.value)}
            />
          </label>
          <label>
            Quiet hours end · IST
            <input
              type="time"
              required
              value={quietEnd}
              disabled={busy}
              onChange={(e) => setQuietEnd(e.target.value)}
            />
          </label>
          <label>
            Daily brief time · IST
            <input
              type="time"
              required
              value={briefAt}
              disabled={busy}
              onChange={(e) => setBriefAt(e.target.value)}
            />
          </label>
        </div>
        <label className="radio-option">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I consent to sync “{plan.name}” ({plan.activities.length} activities)
          and the selected coarse area for these emails.
        </label>
        <button
          className="button secondary"
          disabled={
            busy ||
            reloadRequired ||
            !value ||
            !configured ||
            !consent ||
            !plan.configured ||
            !place?.confirmed ||
            (!review && !brief)
          }
        >
          Enable / update synced subscription
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy || reloadRequired || !value?.subscription?.enabled}
          onClick={() => void save(false)}
        >
          Disable scheduled email
        </button>
      </form>
      <button
        className="text-button"
        type="button"
        disabled={busy}
        onClick={async () => {
          const request = scope.current.capture(),
            session = captureSession()
          setBusy(true)
          try {
            const r = await load(request.signal)
            if (request.isCurrent() && session.isCurrent()) {
              setValue(r)
              setReloadRequired(false)
              setError('')
            }
          } catch (e) {
            if (request.isCurrent() && session.isCurrent())
              setError(e instanceof Error ? e.message : 'Reload failed.')
          } finally {
            if (request.isCurrent() && session.isCurrent()) setBusy(false)
          }
        }}
      >
        {busy ? 'Updating email settings…' : 'Reload email settings'}
      </button>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      <h4>Recent deliveries</h4>
      {value && value.deliveries.length === 0 && (
        <p>No emails have been prepared for this account yet.</p>
      )}
      <ul>
        {value?.deliveries.map((d) => (
          <li key={d.id}>
            {d.date} · {d.kind} · {d.status} · evidence retrieved{' '}
            {d.evidenceAt || 'unavailable'}
          </li>
        ))}
      </ul>
      <p className="help-text">
        “Accepted” means SES accepted the message. “Delivered” requires provider
        feedback. “Unknown” deliveries are not automatically resent. Quiet-hour
        alerts wait and are suppressed if their activity passes.
      </p>
    </section>
  )
}
