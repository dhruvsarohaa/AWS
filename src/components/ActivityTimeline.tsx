import { useState } from 'react'
import type {
  ActivityDecision,
  DashboardData,
  DecisionRecord,
  Language,
  SuggestionFeedback as Feedback,
} from '../types.ts'
import WindowComparison from './WindowComparison.tsx'
import ConcentrationTime from './ConcentrationTime.tsx'
import SuggestionFeedback from './SuggestionFeedback.tsx'
import { localFingerprint } from '../lib/decision-evidence.ts'
import type { ActivityView } from '../lib/activity-view.ts'
import { activityChoice, activityChoiceKey } from '../lib/activity-view.ts'
import { concentration } from '../lib/planner.ts'
import {
  actionLabel,
  reviewReasonLabel,
  say,
  stateLabel,
} from '../lib/labels.ts'

export default function ActivityTimeline({
  views,
  language,
  disabled,
  onAction,
  onInspect,
  onReopen,
  onFollowThrough,
  date,
  data,
  now,
  onHistory,
  feedback,
  locationKey,
  onFeedback,
}: {
  views: ActivityView[]
  language: Language
  disabled: boolean
  onAction: (
    view: ActivityView,
    choice: ActivityDecision,
    start?: string,
    end?: string,
  ) => void
  onInspect: (id: string) => void
  onReopen: (view: ActivityView) => void
  onFollowThrough: (id: string, value: DecisionRecord['followThrough']) => void
  date: string
  data: DashboardData | null
  now: number
  onHistory: (recordId: string) => void
  feedback: Feedback[]
  locationKey: string
  onFeedback: (f: Feedback) => Promise<'saved' | 'session' | 'conflict'>
}) {
  const [choices, setChoices] = useState<Record<string, ActivityDecision>>({})
  const t = (en: string, hi: string) => say(language, en, hi)
  const labels: Record<ActivityView['status'], string> = {
    preview: t('Example / preview', 'उदाहरण / पूर्वावलोकन'),
    recorded: t('Decision recorded', 'निर्णय दर्ज'),
    recheck: t('Review again', 'फिर समीक्षा करें'),
    reopened: t('Reopened for review', 'समीक्षा फिर शुरू'),
    unavailable: t('No fresh forecast', 'ताज़ा पूर्वानुमान नहीं'),
    incomplete: t('Incomplete forecast', 'अधूरा पूर्वानुमान'),
    review: t('Above your review rule', 'आपकी समीक्षा सीमा से ऊपर'),
    ready: t('At or below your rule', 'आपकी सीमा के बराबर या नीचे'),
    passed: t('Finished window', 'समय समाप्त'),
  }
  if (!views.length)
    return (
      <p className="empty-message">
        {t(
          'No activity on this day. Find a one-off time above or edit your recurring plan.',
          'इस दिन कोई गतिविधि नहीं। ऊपर एक समय खोजें या नियमित योजना बदलें।',
        )}
      </p>
    )
  return (
    <div className="activity-list timeline">
      {views.map((v) => {
        const choiceKey = activityChoiceKey(v, date, locationKey)
        const choice = activityChoice(v, choices[choiceKey])
        return (
          <article
            key={v.id}
            id={`activity-${v.id}`}
            tabIndex={-1}
            className={`activity-card ${v.unresolved && ['review', 'recheck', 'reopened'].includes(v.status) ? 'activity-flagged' : ''}`}
          >
            <div className="activity-heading">
              <div>
                <p className="activity-time">
                  {v.current?.chosenWindow?.start || v.start}–
                  {v.current?.chosenWindow?.end || v.end} IST{' '}
                  {v.underway ? t('· In progress', '· जारी') : ''}
                </p>
                <h3>{v.activity}</h3>
                <p>
                  {v.place} ·{' '}
                  {v.oneOff ? t('One-off', 'एक बार') : t('Recurring', 'नियमित')}
                </p>
              </div>
              <span
                className={`badge ${['review', 'recheck', 'reopened', 'incomplete', 'unavailable'].includes(v.status) ? 'warning' : 'neutral'}`}
              >
                {labels[v.status]}
              </span>
            </div>
            <p className="activity-reading">
              <strong>
                {concentration(v.value)} {v.value === null ? '' : 'µg/m³'}
              </strong>{' '}
              ·{' '}
              {t(
                'available regional PM2.5 peak for the original window',
                'मूल समय के उपलब्ध क्षेत्रीय PM2.5 मानों का अधिकतम',
              )}
            </p>
            <p className="help-text">
              {t('Your rule', 'आपकी सीमा')}: {v.contextPlan.threshold} µg/m³ ·{' '}
              {t('Coverage', 'डेटा')}: {v.available}/{v.expected}{' '}
              {t('hourly values', 'प्रति घंटा मान')}
            </p>
            <p className="activity-explanation">
              {v.coverage !== 'complete'
                ? v.value !== null && v.review
                  ? t(
                      'Available values exceed your rule, but this window also has missing forecast data. Review the gaps before choosing a response.',
                      'उपलब्ध मान आपकी सीमा से ऊपर हैं, लेकिन इस समय का कुछ पूर्वानुमान डेटा नहीं है। निर्णय से पहले खाली डेटा देखें।',
                    )
                  : t(
                      'This window does not have complete forecast data. Available low values cannot establish that the whole window is at or below your rule.',
                      'इस समय का पूरा पूर्वानुमान डेटा नहीं है। उपलब्ध कम मानों से पूरे समय को आपकी सीमा के बराबर या नीचे नहीं माना जा सकता।',
                    )
                : v.value === null
                  ? t(
                      'This window has no usable model peak. Review the evidence before choosing a response.',
                      'इस समय का उपयोगी मॉडल अधिकतम नहीं है। निर्णय से पहले डेटा देखें।',
                    )
                  : v.value > v.contextPlan.threshold
                    ? t(
                        'The original window exceeds your chosen rule. Compare feasible times or review another response.',
                        'मूल समय आपकी चुनी सीमा से ऊपर है। व्यावहारिक समय की तुलना या दूसरे निर्णय की समीक्षा करें।',
                      )
                    : t(
                        'The original window is at or below your chosen rule. This does not establish safe air.',
                        'मूल समय आपकी सीमा के बराबर या नीचे है। इससे सुरक्षित हवा साबित नहीं होती।',
                      )}
            </p>
            <details className="calculation-help">
              <summary>
                {t('How this is calculated', 'गणना कैसे की जाती है')}
              </summary>
              <p>
                {t(
                  'Peak PM2.5 across hourly values overlapping the activity, compared with your configured rule. Missing values and old forecasts stay visible. The model cannot verify conditions at a school, street or indoors.',
                  'गतिविधि के घंटों के PM2.5 अधिकतम की तुलना आपकी सीमा से होती है। खाली मान और पुराने पूर्वानुमान दिखते रहते हैं। मॉडल स्कूल, सड़क या अंदर की स्थिति की पुष्टि नहीं करता।',
                )}
              </p>
              <p>
                {data?.forecast?.source ||
                  t(
                    'No forecast source returned',
                    'पूर्वानुमान स्रोत नहीं मिला',
                  )}{' '}
                · {t('Retrieved', 'प्राप्त')}:{' '}
                {data?.forecast?.fetchedAt || t('Unavailable', 'उपलब्ध नहीं')} ·{' '}
                {date} IST
              </p>
            </details>
            {v.current &&
              (v.current.chosenWindow?.start !== v.start ||
                v.current.chosenWindow?.end !== v.end) && (
                <p className="preview-note">
                  {t(
                    'Chosen-window available model peak',
                    'चुने समय के उपलब्ध मॉडल मानों का अधिकतम',
                  )}
                  : {concentration(v.chosen.value)} µg/m³ ·{' '}
                  {stateLabel(v.chosen.coverage, language)}
                </p>
              )}
            {v.reasons.length > 0 && (
              <div className="coverage-warning">
                <strong>
                  {t(
                    'Evidence needs another review',
                    'डेटा की फिर समीक्षा चाहिए',
                  )}
                </strong>
                <ul>
                  {v.reasons.map((r) => (
                    <li key={r}>{reviewReasonLabel(r, language)}</li>
                  ))}
                </ul>
              </div>
            )}
            {v.latest && (
              <details
                className="decision-record"
                open={v.status === 'recheck' || v.status === 'reopened'}
              >
                <summary>
                  {t('Recorded evidence', 'दर्ज डेटा')} ·{' '}
                  {actionLabel(v.latest.choice, language)}
                </summary>
                <p>{v.latest.reason}</p>
                <p>
                  {t('Original', 'मूल')}: {v.latest.originalWindow?.start}–
                  {v.latest.originalWindow?.end} ·{' '}
                  {concentration(v.latest.originalAssessment?.value)} µg/m³
                </p>
                <p>
                  {t('Chosen', 'चुना हुआ')}: {v.latest.chosenWindow?.start}–
                  {v.latest.chosenWindow?.end} ·{' '}
                  {concentration(v.latest.chosenAssessment?.value)} µg/m³
                </p>
                <p className="help-text">
                  {v.latest.date} · {v.latest.location?.name} ·{' '}
                  {t('Snapshot', 'स्नैपशॉट')} {v.latest.snapshotId.slice(0, 8)}{' '}
                  · {stateLabel(v.latest.lifecycle || 'legacy', language)}
                </p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onHistory(v.latest!.id)}
                >
                  {t(
                    'Open this record & report →',
                    'यह रिकॉर्ड और रिपोर्ट खोलें →',
                  )}
                </button>
              </details>
            )}
            <button
              className="text-button"
              type="button"
              onClick={() => onInspect(v.id)}
            >
              {t('Show window on chart ↗', 'चार्ट पर समय देखें ↗')}
            </button>
            {v.status !== 'preview' && (
              <>
                <ConcentrationTime
                  now={now}
                  data={data}
                  date={date}
                  start={v.current?.originalWindow?.start || v.start}
                  end={v.current?.originalWindow?.end || v.end}
                  chosen={
                    v.current?.choice === 'rescheduled' ||
                    v.current?.choice === 'shortened'
                      ? v.current.chosenWindow
                      : undefined
                  }
                  language={language}
                />
                <SuggestionFeedback
                  key={`${date}:${locationKey}:${v.id}:${data?.snapshotId}:${v.contextPlan.threshold}:${v.current?.id || ''}`}
                  assessmentId={localFingerprint(
                    JSON.stringify([
                      date,
                      locationKey,
                      v.id,
                      data?.snapshotId || 'missing',
                      v.contextPlan.threshold,
                      v.start,
                      v.end,
                      v.current?.id || '',
                    ]),
                  )}
                  decisionId={v.current?.id}
                  locationKey={locationKey}
                  date={date}
                  activity={v.activity}
                  feedback={feedback}
                  disabled={disabled}
                  language={language}
                  onSave={onFeedback}
                />
                {v.flexible && !v.passed && (
                  <WindowComparison
                    key={`${date}:${data?.location.latitude}:${data?.location.longitude}:${v.contextPlan.threshold}`}
                    view={v}
                    data={data}
                    date={date}
                    now={now}
                    language={language}
                    disabled={disabled}
                    onRecord={(start, end) =>
                      onAction(v, 'rescheduled', start, end)
                    }
                  />
                )}
                <div className="timeline-action">
                  <label>
                    {t('Choose your response', 'अपना निर्णय चुनें')}
                    <select
                      value={choice}
                      disabled={disabled}
                      onChange={(e) =>
                        setChoices({
                          ...choices,
                          [choiceKey]: e.target.value as ActivityDecision,
                        })
                      }
                    >
                      {(
                        [
                          'outdoors',
                          'indoors',
                          'rescheduled',
                          'shortened',
                          'cancelled',
                        ] as ActivityDecision[]
                      ).map((c) => (
                        <option
                          key={c}
                          value={c}
                          disabled={
                            (c === 'rescheduled' &&
                              (!v.flexible || v.passed)) ||
                            (c === 'shortened' && v.passed)
                          }
                        >
                          {actionLabel(c, language)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button primary"
                    type="button"
                    disabled={disabled}
                    onClick={() => onAction(v, choice)}
                  >
                    {t(
                      v.current ? 'Review & record again' : 'Review & record',
                      v.current
                        ? 'फिर समीक्षा और दर्ज करें'
                        : 'समीक्षा और दर्ज करें',
                    )}
                  </button>
                  {v.current && (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={disabled}
                      onClick={() => onReopen(v)}
                    >
                      {t('Reopen', 'फिर खोलें')}
                    </button>
                  )}
                </div>
                {v.current && (
                  <label className="follow-through">
                    {t('Follow-through', 'पालन')}
                    <select
                      value={v.current.followThrough}
                      disabled={disabled || v.reasons.length > 0}
                      onChange={(e) =>
                        onFollowThrough(
                          v.current!.id,
                          e.target.value as DecisionRecord['followThrough'],
                        )
                      }
                    >
                      <option value="unconfirmed">
                        {t('Not confirmed', 'पुष्टि नहीं')}
                      </option>
                      <option value="completed">
                        {t('Action followed', 'निर्णय का पालन किया')}
                      </option>
                      <option value="changed">
                        {t('Changed afterward', 'बाद में बदला')}
                      </option>
                    </select>
                  </label>
                )}
              </>
            )}
          </article>
        )
      })}
    </div>
  )
}
