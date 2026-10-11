import { useState } from 'react'
import type {
  Activity,
  DashboardData,
  Language,
  OutdoorPlan,
} from '../types.ts'
import {
  clockMinutes,
  concentration,
  FORECAST_MAX_AGE,
  timestampState,
} from '../lib/planner.ts'
import { searchTimes } from '../lib/time-search.ts'
import { say } from '../lib/labels.ts'

export default function QuickTimeFinder({
  data,
  date,
  now,
  confirmed,
  threshold,
  language,
  disabled,
  onChoose,
}: {
  data: DashboardData | null
  date: string
  now: number
  confirmed: boolean
  threshold: number
  language: Language
  disabled: boolean
  onChoose: (activity: Activity, plan: OutdoorPlan) => void
}) {
  const [name, setName] = useState('Walk'),
    [duration, setDuration] = useState(30)
  const [from, setFrom] = useState('07:00'),
    [until, setUntil] = useState('19:00')
  const [rule, setRule] = useState(threshold),
    [ack, setAck] = useState(false),
    [searchBasis, setSearchBasis] = useState(''),
    [error, setError] = useState('')
  const [step, setStep] = useState<'activity' | 'rule'>('activity')
  const basis = JSON.stringify([
    data?.location.latitude,
    data?.location.longitude,
    date,
    name,
    duration,
    from,
    until,
    rule,
  ])
  const searched = searchBasis === basis
  const fresh =
    timestampState(data?.forecast?.fetchedAt, now, FORECAST_MAX_AGE) === 'fresh'
  const options =
    searched && confirmed && fresh
      ? searchTimes({
          points: data?.forecast?.points || [],
          date,
          duration,
          allowedStart: from,
          allowedEnd: until,
          threshold: rule,
          now,
        })
      : []
  const t = (en: string, hi: string) => say(language, en, hi)
  function changed() {
    setSearchBasis('')
    setError('')
  }
  return (
    <section className="card quick-finder" aria-labelledby="quick-title">
      <div className="section-heading">
        <div>
          <h2 id="quick-title" tabIndex={-1}>
            {t('Find a lower-pollution time', 'कम प्रदूषण वाला समय खोजें')}
          </h2>
        </div>
        <span className="badge neutral">{date} · IST</span>
      </div>
      <p className="section-subtitle">
        {t(
          'Compare available regional PM2.5 forecasts within your allowed hours.',
          'अपने उपलब्ध समय में क्षेत्रीय PM2.5 पूर्वानुमानों की तुलना करें।',
        )}
      </p>
      <p className="form-step-label" role="status">
        {step === 'activity'
          ? t(
              'Step 1 of 2 · Activity & allowed hours',
              'चरण 1 / 2 · गतिविधि और उपलब्ध समय',
            )
          : t(
              'Step 2 of 2 · Review your rule',
              'चरण 2 / 2 · अपनी सीमा की समीक्षा',
            )}
      </p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (disabled) return
          if (step === 'activity') {
            if (
              !name.trim() ||
              !Number.isFinite(clockMinutes(from)) ||
              !Number.isFinite(clockMinutes(until)) ||
              clockMinutes(until) - clockMinutes(from) < duration
            ) {
              setError(
                t(
                  'Enter a name and same-day hours that fit the activity duration.',
                  'नाम और उसी दिन का समय भरें जिसमें गतिविधि की अवधि पूरी हो।',
                ),
              )
              return
            }
            setError('')
            setStep('rule')
            requestAnimationFrame(() =>
              document.getElementById('quick-rule')?.focus(),
            )
            return
          }
          if (
            !name.trim() ||
            !ack ||
            !Number.isFinite(rule) ||
            rule < 1 ||
            rule > 1000 ||
            clockMinutes(until) - clockMinutes(from) < duration
          ) {
            setError(
              t(
                'Enter an activity, a valid time range and review rule, then confirm the rule.',
                'गतिविधि, सही समय और समीक्षा सीमा भरें, फिर सीमा की पुष्टि करें।',
              ),
            )
            return
          }
          setError('')
          if (!confirmed || !fresh) return
          setSearchBasis(basis)
        }}
      >
        <div className="quick-fields" hidden={step !== 'activity'}>
          <label>
            {t('Activity', 'गतिविधि')}
            <input
              value={name}
              maxLength={80}
              required
              onChange={(e) => {
                setName(e.target.value)
                changed()
              }}
            />
          </label>
          <label>
            {t('Duration', 'अवधि')}
            <select
              value={duration}
              onChange={(e) => {
                setDuration(Number(e.target.value))
                changed()
              }}
            >
              {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                <option key={m} value={m}>
                  {m} {t('min', 'मिनट')}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Earliest start · IST', 'सबसे पहले · IST')}
            <input
              type="time"
              value={from}
              required
              onInput={(e) => {
                setFrom(e.currentTarget.value)
                changed()
              }}
              onChange={(e) => {
                setFrom(e.target.value)
                changed()
              }}
            />
          </label>
          <label>
            {t('Finish by · IST', 'समाप्ति तक · IST')}
            <input
              type="time"
              value={until}
              required
              onInput={(e) => {
                setUntil(e.currentTarget.value)
                changed()
              }}
              onChange={(e) => {
                setUntil(e.target.value)
                changed()
              }}
            />
          </label>
        </div>
        <div className="quick-rule-panel" hidden={step !== 'rule'}>
          <p>
            <strong>{name}</strong> · {duration} {t('minutes', 'मिनट')} · {from}
            –{until} IST · {date}
          </p>
          <label className="field" htmlFor="quick-rule">
            {t('Review above · µg/m³ PM2.5', 'समीक्षा सीमा · µg/m³ PM2.5')}
            <input
              id="quick-rule"
              type="number"
              min={1}
              max={1000}
              value={rule}
              required
              onChange={(e) => {
                setRule(Number(e.target.value))
                setAck(false)
                changed()
              }}
            />
          </label>
          <p className="help-text">
            {t(
              'The starting rule comes from your plan or its illustrative example. Choose the value that your activity policy uses; Airday does not prescribe a health limit.',
              'आरंभिक सीमा आपकी योजना या उसके उदाहरण से आती है। अपनी गतिविधि की नीति के अनुसार मान चुनें; Airday स्वास्थ्य सीमा तय नहीं करता।',
            )}
          </p>
          <label className="radio-option">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => {
                setAck(e.target.checked)
                changed()
              }}
            />
            {t(
              'I choose this review rule. It is not an official limit or proof of safe air.',
              'यह मेरी समीक्षा सीमा है। यह आधिकारिक सीमा या सुरक्षित हवा का प्रमाण नहीं है।',
            )}
          </label>
        </div>
        {!confirmed || !fresh ? (
          <p className="coverage-warning">
            {!confirmed
              ? t(
                  'Confirm your location first.',
                  'पहले अपने स्थान की पुष्टि करें।',
                )
              : t(
                  'A fresh regional forecast is needed for comparisons. Refresh the evidence.',
                  'तुलना के लिए ताज़ा क्षेत्रीय पूर्वानुमान चाहिए। डेटा रीफ़्रेश करें।',
                )}
          </p>
        ) : null}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          {step === 'rule' && (
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => {
                setStep('activity')
                setError('')
                setSearchBasis('')
              }}
            >
              {t('Back to activity', 'गतिविधि पर वापस')}
            </button>
          )}
          <button
            className="button primary"
            disabled={disabled || (step === 'rule' && (!confirmed || !fresh))}
          >
            {step === 'activity'
              ? t('Continue to review rule', 'सीमा की समीक्षा के लिए आगे बढ़ें')
              : t('Compare times', 'समय की तुलना करें')}
          </button>
        </div>
      </form>
      {searched && (
        <div className="time-results" aria-live="polite">
          <h3>{t('Complete model windows', 'पूरे डेटा वाले समय')}</h3>
          {options.length ? (
            <div className="time-options">
              {options.map((option, i) => (
                <article key={option.start} className="time-option">
                  <h3>
                    {option.start}–{option.end}
                  </h3>
                  <p className="section-meta">
                    {i === 0
                      ? t('Lowest available peak', 'सबसे कम उपलब्ध अधिकतम मान')
                      : t('Alternative', 'विकल्प')}
                  </p>
                  <p>
                    <strong>{concentration(option.value)} µg/m³</strong> PM2.5 ·{' '}
                    {t('peak', 'अधिकतम')}
                  </p>
                  <p className="help-text">
                    {t('Mean', 'औसत')} {concentration(option.mean)} µg/m³ ·{' '}
                    {option.review
                      ? t('Above your rule', 'आपकी सीमा से ऊपर')
                      : t(
                          'At or below your rule',
                          'आपकी सीमा के बराबर या नीचे',
                        )}
                  </p>
                  <button
                    type="button"
                    disabled={disabled}
                    className="button secondary"
                    onClick={() => {
                      const activity: Activity = {
                        id: crypto.randomUUID(),
                        activity: name.trim(),
                        place: data?.location.name || '',
                        start: option.start,
                        end: option.end,
                        days: [new Date(`${date}T12:00:00Z`).getUTCDay()],
                        flexible: true,
                        allowedStart: from,
                        allowedEnd: until,
                      }
                      onChoose(activity, {
                        name: 'One-off activity',
                        configured: true,
                        threshold: rule,
                        ruleMode: 'custom',
                        activities: [activity],
                      })
                    }}
                  >
                    {t('Review this time', 'इस समय की समीक्षा करें')}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p>
              {t(
                'No complete future window fits these hours. Widen the range or change the duration; missing values are not filled in.',
                'इन घंटों में पूरे डेटा वाला आगामी समय नहीं मिला। समय सीमा या अवधि बदलें; खाली डेटा भरा नहीं जाता।',
              )}
            </p>
          )}
          <p className="help-text">
            {t(
              'Ranked by lower peak, then overlap-weighted mean, then earlier time. Only complete windows qualify. A 15-minute search step does not imply 15-minute model accuracy: CAMS Global is roughly 45 km with three-hour source steps. These are approximate comparisons, not safe-time guarantees.',
              'कम अधिकतम मान, फिर समय के अनुसार भारित औसत, फिर पहले समय के आधार पर क्रम। केवल पूरे डेटा वाले समय शामिल हैं। 15 मिनट के खोज अंतराल का अर्थ 15 मिनट की सटीकता नहीं है: CAMS Global लगभग 45 किमी और तीन घंटे के स्रोत अंतराल पर है। यह अनुमानित तुलना है, सुरक्षा की गारंटी नहीं।',
            )}
          </p>
        </div>
      )}
    </section>
  )
}
