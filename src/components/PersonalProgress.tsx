import { useEffect, useId, useRef, useState } from 'react'
import type { Language, LocalState, Place } from '../types.ts'
import { privateRecapExport, recap, validRecapDate } from '../lib/recap.ts'
import { reviewedLocation } from '../lib/decision-evidence.ts'
import { addDays, dateInIndia } from '../lib/planner.ts'
import { downloadText } from '../lib/reports.ts'
import { say, actionLabel, stateLabel } from '../lib/labels.ts'
import {
  clearReviewedFeedback,
  reviewFeedbackDeletion,
} from '../lib/suggestion-feedback.ts'
export default function PersonalProgress({
  state,
  place,
  language,
  disabled,
  onCommit,
}: {
  state: LocalState
  place: Place
  language: Language
  disabled: boolean
  onCommit: (s: LocalState) => Promise<'saved' | 'session' | 'conflict'>
}) {
  const [to, setTo] = useState(dateInIndia()),
    [days, setDays] = useState(7),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [clearReview, setClearReview] = useState<LocalState | null>(null)
  const clearTrigger = useRef<HTMLButtonElement>(null),
    cancelButton = useRef<HTMLButtonElement>(null),
    recapHeading = useRef<HTMLHeadingElement>(null),
    clearId = useId()
  const t = (en: string, hi: string) => say(language, en, hi),
    from = addDays(to, 1 - days),
    r = recap(state.journal, from, to, reviewedLocation(place).key)
  function cancelClear() {
    if (busy) return
    setClearReview(null)
    requestAnimationFrame(() => clearTrigger.current?.focus())
  }
  useEffect(() => {
    if (!clearReview) return
    cancelButton.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        setClearReview(null)
        event.preventDefault()
        requestAnimationFrame(() => clearTrigger.current?.focus())
      }
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [clearReview, busy])
  async function clearFeedback() {
    if (disabled || busy || !clearReview) return
    if (JSON.stringify(clearReview) !== JSON.stringify(state)) {
      setMessage(
        t(
          'Planning changed after this review opened. Cancel and review deletion again.',
          'यह समीक्षा खोलने के बाद योजना बदली। रद्द करें और हटाने की फिर समीक्षा करें।',
        ),
      )
      return
    }
    setBusy(true)
    try {
      const result = await onCommit(clearReviewedFeedback(state, clearReview))
      setMessage(
        result === 'saved'
          ? t(
              'Feedback cleared from browser storage.',
              'ब्राउज़र संग्रह से प्रतिक्रिया हटा दी गई।',
            )
          : result === 'session'
            ? t(
                'Cleared in this session only. Stored deletion did not complete.',
                'केवल इस सत्र में हटाया गया। संग्रह से हटाना पूरा नहीं हुआ।',
              )
            : t(
                'Not cleared. Resolve the storage conflict.',
                'नहीं हटाया गया। संग्रह विरोध हल करें।',
              ),
      )
      if (result !== 'conflict') {
        setClearReview(null)
        requestAnimationFrame(() => recapHeading.current?.focus())
      }
    } catch {
      setMessage(
        t(
          'Feedback could not be cleared. Export and check storage recovery options.',
          'प्रतिक्रिया नहीं हटाई जा सकी। निर्यात करें और संग्रह रिकवरी विकल्प देखें।',
        ),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      id="personal-progress"
      tabIndex={-1}
      className="card personal-progress"
    >
      <h2 ref={recapHeading} tabIndex={-1}>
        {t('Daily & weekly recap', 'दैनिक और साप्ताहिक सारांश')}
      </h2>
      <p className="section-meta">
        {t('Private · self-reported', 'निजी · स्वयं बताया')}
      </p>
      <div className="r2-form-row">
        <label>
          {t('Through (IST date)', 'तक (IST तिथि)')}
          <input
            type="date"
            value={to}
            max={dateInIndia()}
            onChange={(e) =>
              validRecapDate(e.target.value) &&
              e.target.value <= dateInIndia() &&
              setTo(e.target.value)
            }
          />
        </label>
        <label>
          {t('Range', 'अवधि')}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>{t('Daily', 'दैनिक')}</option>
            <option value={7}>{t('Weekly', 'साप्ताहिक')}</option>
          </select>
        </label>
      </div>
      <p>
        {place.name} · {from} → {to} ·{' '}
        {t('Retained history only', 'केवल रखा गया इतिहास')}
      </p>
      {r.unknownPlannedMinutes > 0 && (
        <p className="preview-note" role="status">
          {r.unknownPlannedMinutes}{' '}
          {t(
            'reviewed records lack a retained chosen time. Their chosen minutes are unknown and excluded from the subtotal.',
            'समीक्षित रिकॉर्ड में चुना समय दर्ज नहीं। उनके चुने मिनट अज्ञात हैं और उप-योग में नहीं गिने गए।',
          )}
        </p>
      )}
      <div className="recap-grid">
        <article>
          <strong>{r.recorded.length}</strong>
          <span>{t('Reviewed activities', 'समीक्षित गतिविधियां')}</span>
        </article>
        <article>
          <strong>{r.reviewedScheduledMinutes}</strong>
          <span>
            {t(
              'Original scheduled minutes in reviewed records',
              'समीक्षित रिकॉर्ड में मूल निर्धारित मिनट',
            )}
          </span>
        </article>
        <article>
          <strong>{r.chosenOutdoorMinutes}</strong>
          <span>
            {t('Chosen planned outdoor minutes', 'चुने नियोजित बाहरी मिनट')}
          </span>
        </article>
        <article>
          <strong>{r.reportedActions}</strong>
          <span>{t('Actions reported followed', 'पालन बताए गए निर्णय')}</span>
        </article>
      </div>
      <p>
        {r.unresolved}{' '}
        {t('reopened / unresolved records', 'फिर खुले / अनसुलझे रिकॉर्ड')} ·{' '}
        {r.changed} {t('changed afterward', 'बाद में बदले')} · {r.unconfirmed}{' '}
        {t('follow-through unconfirmed', 'पालन अपुष्ट')}.
      </p>
      <p className="help-text">
        {t(
          'Minutes come from frozen plans, not tracked activity. Even for actions reported followed, actual duration was not measured. Unreviewed timetable blocks and missing days are not counted; a zero is not a complete school-day total. Reopened and superseded choices do not count twice. No health score, leaderboard or pollution savings.',
          'मिनट स्थिर योजनाओं से हैं, गतिविधि ट्रैकिंग से नहीं। पालन बताने पर भी वास्तविक अवधि नहीं मापी गई। असमीक्षित समय और खाली दिन नहीं गिने जाते। फिर खुले और पुराने निर्णय दो बार नहीं गिने जाते। कोई स्वास्थ्य अंक या बचत नहीं।',
        )}
      </p>
      {!r.rows.length ? (
        <p className="empty-message">
          {t(
            'No retained decisions for this place and range. Start by reviewing an activity; this is not evidence of zero pollution or zero activity.',
            'इस स्थान और अवधि के निर्णय नहीं। पहले गतिविधि की समीक्षा करें; यह शून्य प्रदूषण या गतिविधि का प्रमाण नहीं।',
          )}
        </p>
      ) : (
        <details>
          <summary>
            {t(
              'Included dated records & frozen estimates',
              'शामिल रिकॉर्ड और स्थिर अनुमान',
            )}
          </summary>
          <ul>
            {r.rows.map((x) => (
              <li key={x.id}>
                {x.date} · {x.activity} · {actionLabel(x.choice, language)} ·{' '}
                {stateLabel(x.lifecycle || 'legacy', language)}.{' '}
                {x.modelEstimate
                  ? `${t('Frozen PM2.5 model concentration × planned time', 'स्थिर PM2.5 मॉडल सांद्रता × नियोजित समय')}: ${t('original', 'मूल')} ${x.modelEstimate.original ?? t('withheld', 'नहीं दिखाया')}, ${t('chosen', 'चुना')} ${x.modelEstimate.chosen ?? t('withheld', 'नहीं दिखाया')} ${x.modelEstimate.unit} (${t('hourly sample hold; no dose or saving', 'प्रति घंटे स्थिर नमूना; सांस की मात्रा या बचत नहीं')}).`
                  : t(
                      'Concentration-time estimate was not retained for this older record.',
                      'इस पुराने रिकॉर्ड का सांद्रता-समय अनुमान दर्ज नहीं है।',
                    )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="button-row">
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            downloadText(
              JSON.stringify(
                privateRecapExport(
                  state.journal,
                  from,
                  to,
                  reviewedLocation(place),
                  state.feedback,
                ),
                null,
                2,
              ),
              'airday-private-recap.json',
              'application/json',
            )
          }
        >
          {t('Export this private recap', 'निजी सारांश निर्यात करें')}
        </button>
        <button
          type="button"
          className="text-button"
          ref={clearTrigger}
          disabled={
            disabled || busy || Boolean(clearReview) || !state.feedback.length
          }
          onClick={() => {
            setMessage('')
            setClearReview(reviewFeedbackDeletion(state))
          }}
        >
          {t('Clear all local feedback', 'सभी स्थानीय प्रतिक्रियाएं हटाएं')} (
          {state.feedback.length})
        </button>
      </div>
      <p className="help-text">
        {t(
          'This private recap includes activity names, reasons and feedback for the selected place and dates. Coordinates are excluded. Clear all local planning from Settings to remove the decision history used for progress.',
          'निजी सारांश में चुने स्थान और तारीखों की गतिविधि के नाम, कारण और प्रतिक्रिया शामिल हैं। निर्देशांक नहीं हैं। प्रगति के निर्णय इतिहास को हटाने के लिए सेटिंग्स में सभी स्थानीय योजना हटाएं।',
        )}
      </p>
      {clearReview && (
        <section className="preview-note" aria-labelledby={clearId}>
          <h3 id={clearId}>
            {t('Review feedback deletion', 'प्रतिक्रिया हटाने की समीक्षा')}
          </h3>
          <p>
            {t(
              'Delete all local feedback across every place and date?',
              'हर स्थान और तारीख की सभी स्थानीय प्रतिक्रियाएं हटाएं?',
            )}{' '}
            ({clearReview.feedback.length}){' '}
            {t(
              'Decisions, plans and progress history stay retained. Export all feedback first if needed; this recap contains only the selected range.',
              'निर्णय, योजना और प्रगति इतिहास सुरक्षित रहेंगे। जरूरत हो तो पहले सभी प्रतिक्रियाएं निर्यात करें; इस सारांश में केवल चुनी अवधि है।',
            )}
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                downloadText(
                  JSON.stringify(
                    {
                      format: 'airday-private-feedback',
                      version: 1,
                      feedback: clearReview.feedback,
                    },
                    null,
                    2,
                  ),
                  'airday-private-feedback.json',
                  'application/json',
                )
              }
            >
              {t(
                'Export all reviewed feedback',
                'समीक्षित सभी प्रतिक्रियाएं निर्यात करें',
              )}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={disabled || busy}
              onClick={() => void clearFeedback()}
            >
              {t(
                'Confirm feedback deletion',
                'प्रतिक्रिया हटाने की पुष्टि करें',
              )}
            </button>
            <button
              ref={cancelButton}
              type="button"
              className="text-button"
              disabled={busy}
              onClick={cancelClear}
            >
              {t('Cancel deletion', 'हटाना रद्द करें')}
            </button>
          </div>
        </section>
      )}
      <p role="status">{message}</p>
    </section>
  )
}
