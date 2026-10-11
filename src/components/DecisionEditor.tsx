import { useEffect, useRef, useState } from 'react'
import type {
  Activity,
  ActivityDecision,
  ForecastPoint,
  Language,
} from '../types.ts'
import { clockMinutes } from '../lib/planner.ts'
import { assessWindow } from '../lib/decision-evidence.ts'
import { actionLabel, say, stateLabel } from '../lib/labels.ts'

export default function DecisionEditor({
  activity,
  choice,
  proposedStart,
  proposedEnd,
  evidenceLabel,
  date,
  language = 'en',
  points,
  threshold,
  fetchedAt,
  now,
  onClose,
  onSave,
}: {
  activity: Activity
  choice: ActivityDecision
  proposedStart?: string
  proposedEnd?: string
  evidenceLabel: string
  date: string
  language?: Language
  points: ForecastPoint[]
  threshold: number
  fetchedAt?: string
  now: number
  onClose: () => void
  onSave: (reason: string, start?: string, end?: string) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [start, setStart] = useState(proposedStart || activity.start),
    [end, setEnd] = useState(proposedEnd || activity.end),
    [error, setError] = useState(''),
    [discarding, setDiscarding] = useState(false),
    [busy, setBusy] = useState(false),
    [errorField, setErrorField] = useState<
      'reason' | 'indoor' | 'time' | 'save'
    >('reason')
  const t = (en: string, hi: string) => say(language, en, hi)
  const chosen = assessWindow(
    { ...activity, start, end },
    points,
    date,
    threshold,
    now,
    fetchedAt,
  )
  const discardButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (discarding) discardButton.current?.focus()
  }, [discarding])
  function invalid(field: typeof errorField, message: string) {
    setErrorField(field)
    setError(message)
    dialog.current
      ?.querySelector<HTMLElement>(`[data-field="${field}"]`)
      ?.focus()
  }
  function close() {
    if (busy) return
    if (
      reason.trim() ||
      start !== (proposedStart || activity.start) ||
      end !== (proposedEnd || activity.end) ||
      confirmed
    )
      setDiscarding(true)
    else onClose()
  }
  useEffect(() => {
    const element = dialog.current,
      trigger = document.activeElement as HTMLElement | null,
      overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element?.showModal()
    element?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    return () => {
      element?.close()
      document.body.style.overflow = overflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="plan-dialog decision-dialog"
      aria-labelledby="action-title"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <div className="dialog-heading">
        <div>
          <h2 id="action-title">
            {t('Record your decision', 'अपना निर्णय दर्ज करें')}
          </h2>
          <p>
            {activity.activity} · {actionLabel(choice, language)}
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={t('Close decision editor', 'निर्णय संपादक बंद करें')}
          onClick={close}
          disabled={busy}
        >
          ×
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (busy) return
          if (!reason.trim()) {
            invalid(
              'reason',
              t(
                'Explain the reason for this decision.',
                'इस निर्णय का कारण बताएं।',
              ),
            )
            return
          }
          if (choice === 'indoors' && !confirmed) {
            invalid(
              'indoor',
              t(
                'Confirm a suitable indoor option, or choose another action.',
                'उपयुक्त अंदर के विकल्प की पुष्टि करें या दूसरा निर्णय चुनें।',
              ),
            )
            return
          }
          if (
            ['rescheduled', 'shortened'].includes(choice) &&
            (!Number.isFinite(clockMinutes(start)) ||
              !Number.isFinite(clockMinutes(end)) ||
              end <= start ||
              (choice === 'shortened' &&
                clockMinutes(end) - clockMinutes(start) >=
                  clockMinutes(activity.end) - clockMinutes(activity.start)))
          ) {
            invalid(
              'time',
              t(
                'Choose valid times; a shortened activity must be shorter than the original.',
                'सही समय चुनें; छोटा किया समय मूल से कम होना चाहिए।',
              ),
            )
            return
          }
          if (
            choice === 'rescheduled' &&
            (!activity.flexible ||
              start < (activity.allowedStart || activity.start) ||
              end > (activity.allowedEnd || activity.end) ||
              clockMinutes(end) - clockMinutes(start) !==
                clockMinutes(activity.end) - clockMinutes(activity.start))
          ) {
            invalid(
              'time',
              t(
                'Reschedule within your allowed range and keep the original duration. Edit the activity first to allow other times.',
                'अनुमत समय में मूल अवधि रखते हुए समय बदलें। दूसरे समय के लिए पहले गतिविधि बदलें।',
              ),
            )
            return
          }
          if (
            choice === 'shortened' &&
            (start < activity.start || end > activity.end)
          ) {
            invalid(
              'time',
              t(
                'Keep a shortened activity within its original time window.',
                'छोटा किया समय मूल समय सीमा में रखें।',
              ),
            )
            return
          }
          if (
            ['rescheduled', 'shortened'].includes(choice) &&
            Date.parse(`${date}T${start}:00+05:30`) <= Date.now()
          ) {
            invalid(
              'time',
              t(
                'Choose a future window. Record follow-through for a finished activity instead.',
                'आगामी समय चुनें। समाप्त गतिविधि के लिए पालन दर्ज करें।',
              ),
            )
            return
          }
          setError('')
          setBusy(true)
          try {
            await onSave(reason.trim(), start, end)
          } catch (cause) {
            invalid(
              'save',
              cause instanceof Error
                ? cause.message
                : 'The decision could not save. Your draft is retained.',
            )
          } finally {
            setBusy(false)
          }
        }}
      >
        <p className="help-text">{evidenceLabel}</p>
        <label className="field">
          {t('Reason', 'कारण')}
          <textarea
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-field="reason"
            disabled={busy}
            aria-invalid={Boolean(error && errorField === 'reason')}
            aria-describedby={
              error && errorField === 'reason' ? 'decision-error' : undefined
            }
            required
          />
        </label>
        {choice === 'indoors' && (
          <label className="radio-option">
            <input
              type="checkbox"
              data-field="indoor"
              disabled={busy}
              aria-invalid={Boolean(error && errorField === 'indoor')}
              aria-describedby={
                error && errorField === 'indoor' ? 'decision-error' : undefined
              }
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t(
              'I have a suitable indoor alternative. Outdoor forecasts do not verify indoor air.',
              'मेरे पास उपयुक्त अंदर का विकल्प है। बाहरी पूर्वानुमान अंदर की हवा की पुष्टि नहीं करता।',
            )}
          </label>
        )}
        {['rescheduled', 'shortened'].includes(choice) && (
          <div className="field-grid">
            <label className="field">
              {t('Chosen start · IST', 'चुना आरंभ · IST')}
              <input
                type="time"
                data-field="time"
                disabled={busy}
                aria-invalid={Boolean(error && errorField === 'time')}
                aria-describedby={
                  error && errorField === 'time' ? 'decision-error' : undefined
                }
                value={start}
                onInput={(event) => setStart(event.currentTarget.value)}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
            <label className="field">
              {t('Chosen end · IST', 'चुना अंत · IST')}
              <input
                type="time"
                disabled={busy}
                aria-invalid={Boolean(error && errorField === 'time')}
                aria-describedby={
                  error && errorField === 'time' ? 'decision-error' : undefined
                }
                value={end}
                onInput={(event) => setEnd(event.currentTarget.value)}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          </div>
        )}
        {['rescheduled', 'shortened'].includes(choice) && (
          <p className="preview-note">
            {t('Chosen-window model peak', 'चुने समय का मॉडल अधिकतम')}:{' '}
            {chosen.value === null ? '—' : Math.round(chosen.value)} µg/m³ PM2.5
            · {stateLabel(chosen.coverage, language)} ·{' '}
            {stateLabel(chosen.freshness, language)} ·{' '}
            {chosen.review
              ? t('above your rule', 'आपकी सीमा से ऊपर')
              : chosen.coverage === 'complete'
                ? t(
                    'at or below your rule; this does not establish safe air',
                    'आपकी सीमा के बराबर या नीचे; इससे सुरक्षित हवा साबित नहीं होती',
                  )
                : t(
                    'no available value above your rule; incomplete data cannot establish a complete comparison',
                    'कोई उपलब्ध मान सीमा से ऊपर नहीं; अधूरा डेटा पूर्ण तुलना नहीं बताता',
                  )}
          </p>
        )}
        {error && (
          <p id="decision-error" className="field-error" role="alert">
            {error}
          </p>
        )}
        <p className="help-text">
          {t(
            'Your reason, data snapshot and review rule are recorded together. This is your decision, not an official order.',
            'कारण, डेटा स्नैपशॉट और समीक्षा सीमा एक साथ दर्ज होते हैं। यह आपका निर्णय है, आधिकारिक आदेश नहीं।',
          )}
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            disabled={busy}
            className="button secondary"
            onClick={close}
          >
            {t('Cancel', 'रद्द करें')}
          </button>
          <button type="submit" disabled={busy} className="button primary">
            {busy
              ? t('Saving…', 'सहेज रहा है…')
              : t('Record decision', 'निर्णय दर्ज करें')}
          </button>
        </div>
      </form>
      {discarding && (
        <div className="discard-confirmation" role="alert">
          <p>
            {t(
              'Discard this unsaved decision?',
              'यह बिना सहेजा निर्णय छोड़ें?',
            )}
          </p>
          <button
            ref={discardButton}
            type="button"
            className="button secondary"
            onClick={() => setDiscarding(false)}
          >
            {t('Keep editing', 'संपादन जारी रखें')}
          </button>
          <button type="button" className="button danger" onClick={onClose}>
            {t('Discard decision', 'निर्णय छोड़ें')}
          </button>
        </div>
      )}
    </dialog>
  )
}
