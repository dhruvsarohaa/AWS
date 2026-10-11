import { useState } from 'react'
import type { DecisionRecord, Language } from '../types.ts'
import { actionLabel, say, stateLabel } from '../lib/labels.ts'
import { concentration } from '../lib/planner.ts'
import { decisionCsv, downloadText, reportDetails } from '../lib/reports.ts'
import DecisionSummary from './DecisionSummary.tsx'

export default function HistoryView({
  journal,
  language,
  sessionOnly,
  initialRecordId = '',
  onClearScope,
  active = true,
  disabled = false,
  onFollowThrough,
}: {
  journal: DecisionRecord[]
  language: Language
  sessionOnly: boolean
  initialRecordId?: string
  onClearScope?: () => void
  active?: boolean
  disabled?: boolean
  onFollowThrough?: (
    id: string,
    value: DecisionRecord['followThrough'],
  ) => Promise<void>
}) {
  const initialRecord = journal.find((r) => r.id === initialRecordId)
  const [date, setDate] = useState(initialRecord?.date || ''),
    [location, setLocation] = useState(initialRecord?.location?.key || ''),
    [activity, setActivity] = useState(initialRecord?.activity || ''),
    [lifecycle, setLifecycle] = useState(''),
    [selected, setSelected] = useState<string | null>(
      initialRecord?.id || null,
    ),
    [includePrivate, setIncludePrivate] = useState(false),
    [savingFollowThrough, setSavingFollowThrough] = useState(false)
  const t = (en: string, hi: string) => say(language, en, hi)
  const rows = [...journal]
    .reverse()
    .filter(
      (r) =>
        (!date || r.date === date) &&
        (!location || r.location?.key === location) &&
        (!activity ||
          r.activity
            .toLocaleLowerCase()
            .includes(activity.toLocaleLowerCase())) &&
        (!lifecycle || (r.lifecycle || 'legacy') === lifecycle),
    )
  const record = rows.find((r) => r.id === selected),
    locations = [
      ...new Map(
        journal
          .filter((r) => r.location)
          .map((r) => [r.location!.key, r.location!]),
      ).values(),
    ]
  return (
    <section
      id="history"
      className="card history-card"
      aria-labelledby="history-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="history-title" tabIndex={-1}>
            {t('Decision history & reports', 'निर्णय इतिहास और रिपोर्ट')}
          </h2>
          <p className="section-meta">
            {t('Private · this browser', 'निजी · इस ब्राउज़र में')}
          </p>
        </div>
        <span className="badge neutral">
          {rows.length}/{journal.length}
        </span>
      </div>
      <p className="help-text">
        {t(
          'Reports use evidence frozen when you recorded the decision, including the original and chosen window. They do not recalculate history from today’s plan. Last 200 local records retained.',
          'रिपोर्ट निर्णय के समय दर्ज मूल और चुने हुए समय का डेटा उपयोग करती है। वर्तमान योजना से इतिहास दोबारा नहीं बनाया जाता। अंतिम 200 स्थानीय रिकॉर्ड रखे जाते हैं।',
        )}
      </p>
      {sessionOnly && (
        <p className="coverage-warning">
          {t(
            'Session-only changes: export before closing this page.',
            'केवल इस सत्र में बदलाव: पेज बंद करने से पहले निर्यात करें।',
          )}
        </p>
      )}
      {initialRecordId && !initialRecord && (
        <p className="coverage-warning">
          {t(
            'This record is not in the local journal. It may belong to another browser or have been removed. No replacement record was selected.',
            'यह रिकॉर्ड स्थानीय इतिहास में नहीं है। यह दूसरे ब्राउज़र का या हटाया हुआ हो सकता है। दूसरा रिकॉर्ड नहीं चुना गया।',
          )}
        </p>
      )}
      <div className="quick-fields">
        <label>
          {t('Date', 'तारीख')}
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setSelected(null)
            }}
          />
        </label>
        <label>
          {t('Location', 'स्थान')}
          <select
            value={location}
            onChange={(e) => {
              setLocation(e.target.value)
              setSelected(null)
            }}
          >
            <option value="">{t('All locations', 'सभी स्थान')}</option>
            {locations.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}, {p.state}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Activity', 'गतिविधि')}
          <input
            value={activity}
            onChange={(e) => {
              setActivity(e.target.value)
              setSelected(null)
            }}
          />
        </label>
        <label>
          {t('Record state', 'रिकॉर्ड की स्थिति')}
          <select
            value={lifecycle}
            onChange={(e) => {
              setLifecycle(e.target.value)
              setSelected(null)
            }}
          >
            <option value="">{t('All records', 'सभी रिकॉर्ड')}</option>
            {['recorded', 'reopened', 'superseded', 'legacy'].map((s) => (
              <option key={s} value={s}>
                {stateLabel(s, language)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="radio-option">
        <input
          type="checkbox"
          checked={includePrivate}
          onChange={(e) => setIncludePrivate(e.target.checked)}
        />
        {t(
          'Include private activity, plan and place names and my reasons in exports',
          'निर्यात में निजी गतिविधि, योजना, स्थान नाम और मेरे कारण शामिल करें',
        )}
      </label>
      <div className="button-row">
        <button
          type="button"
          className="button secondary"
          disabled={!rows.length}
          onClick={() =>
            downloadText(
              decisionCsv(rows, { includePrivate }),
              'airday-decisions.csv',
              'text/csv;charset=utf-8',
            )
          }
        >
          {t('Export filtered CSV', 'छांटी हुई CSV निर्यात करें')}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setDate('')
            setLocation('')
            setActivity('')
            setLifecycle('')
            setSelected(null)
            onClearScope?.()
          }}
        >
          {t('Reset filters', 'फ़िल्टर हटाएं')}
        </button>
      </div>
      <p className="help-text">
        {t(
          'Private labels and reasons are omitted by default. The option above applies to CSV, the selected print report and its text summary. Coordinates are never included. Dates, activity times, evidence and record IDs remain in every export; review before sharing.',
          'निजी नाम और कारण डिफ़ॉल्ट रूप से छोड़े जाते हैं। ऊपर का विकल्प CSV, चुनी प्रिंट रिपोर्ट और उसके सारांश पर लागू होता है। निर्देशांक कभी शामिल नहीं होते। तारीख, गतिविधि समय, डेटा और रिकॉर्ड ID हर निर्यात में रहते हैं; साझा करने से पहले देखें।',
        )}
      </p>
      <div className="history-list">
        {rows.length ? (
          rows.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`history-row ${record?.id === r.id ? 'selected' : ''}`}
              aria-pressed={record?.id === r.id}
              onClick={() => setSelected(r.id)}
            >
              <span>
                <strong>{r.activity}</strong>
                <small>
                  {r.date} ·{' '}
                  {r.location?.name ||
                    t('Location not retained', 'स्थान दर्ज नहीं')}{' '}
                  · {r.chosenWindow?.start || '—'}–{r.chosenWindow?.end || '—'}{' '}
                  IST
                </small>
              </span>
              <span>
                {actionLabel(r.choice, language)}
                <small>{stateLabel(r.lifecycle || 'legacy', language)}</small>
              </span>
            </button>
          ))
        ) : (
          <p className="empty-message">
            {journal.length
              ? t(
                  'No records match these filters.',
                  'इन फ़िल्टर में कोई रिकॉर्ड नहीं है।',
                )
              : t(
                  'Record a decision to create your first evidence report.',
                  'पहली डेटा रिपोर्ट के लिए एक निर्णय दर्ज करें।',
                )}
          </p>
        )}
      </div>
      {record && (
        <div className="report-preview">
          <div className="section-heading">
            <h3>
              {t('Selected record preview', 'चुने हुए रिकॉर्ड का पूर्वावलोकन')}
            </h3>
            <button
              type="button"
              className="button secondary"
              onClick={() => window.print()}
            >
              {t('Print / save PDF', 'प्रिंट / PDF सहेजें')}
            </button>
          </div>
          {onFollowThrough && (
            <div className="historical-follow-through">
              <label className="follow-through">
                {t('Reported follow-through', 'आपके अनुसार पालन')}
                <select
                  value={record.followThrough}
                  disabled={
                    disabled ||
                    savingFollowThrough ||
                    record.choice === 'pending' ||
                    ['reopened', 'superseded'].includes(record.lifecycle || '')
                  }
                  onChange={async (e) => {
                    const value = e.target
                      .value as DecisionRecord['followThrough']
                    setSavingFollowThrough(true)
                    try {
                      await onFollowThrough(record.id, value)
                    } finally {
                      setSavingFollowThrough(false)
                    }
                  }}
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
              <p className="help-text">
                {savingFollowThrough
                  ? t('Saving follow-through…', 'पालन सहेज रहे हैं…')
                  : t(
                      'Your report updates this historical record, including after its activity is removed. Reopened and replaced records remain read-only.',
                      'गतिविधि हटने के बाद भी आपकी रिपोर्ट इस पुराने रिकॉर्ड को अपडेट करती है। फिर खोले और बदले रिकॉर्ड केवल पढ़े जा सकते हैं।',
                    )}
              </p>
            </div>
          )}
          <FrozenReport
            record={record}
            language={language}
            sessionOnly={sessionOnly}
            includePrivate={includePrivate}
          />
          <DecisionSummary
            key={record.id}
            record={record}
            language={language}
            includePrivate={includePrivate}
          />
        </div>
      )}
      <div className="print-report">
        {active && record && (
          <FrozenReport
            record={record}
            language={language}
            sessionOnly={sessionOnly}
            includePrivate={includePrivate}
          />
        )}
      </div>
    </section>
  )
}
export function FrozenReport({
  record: r,
  language,
  sessionOnly,
  includePrivate = false,
}: {
  record: DecisionRecord
  language: Language
  sessionOnly: boolean
  includePrivate?: boolean
}) {
  const t = (en: string, hi: string) => say(language, en, hi)
  const details = reportDetails(r, { includePrivate }, language)
  const reading = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value) || value < 0
      ? t('Not available', 'उपलब्ध नहीं')
      : `${concentration(value)} µg/m³`
  const windowLabel = (window: DecisionRecord['originalWindow']) =>
    window ? `${window.start}–${window.end}` : t('Not retained', 'दर्ज नहीं')
  return (
    <article className="frozen-report" lang={language}>
      <h2>
        Airday · {t('Activity decision record', 'गतिविधि निर्णय रिकॉर्ड')}
      </h2>
      <p>
        {r.date} · {details.location} · {details.plan}
      </p>
      <h3>
        {details.activity} · {actionLabel(r.choice, language)}
      </h3>
      <p>
        {t('Reason', 'कारण')}: {details.reason}
      </p>
      <dl>
        <div>
          <dt>{t('Original window · IST', 'मूल समय · IST')}</dt>
          <dd>
            {windowLabel(r.originalWindow)} · PM2.5 {t('peak', 'अधिकतम')}{' '}
            {reading(r.originalAssessment?.value)} ·{' '}
            {stateLabel(r.originalAssessment?.coverage, language)} ·{' '}
            {stateLabel(r.originalAssessment?.freshness, language)}
          </dd>
        </div>
        <div>
          <dt>{t('Chosen window · IST', 'चुना समय · IST')}</dt>
          <dd>
            {windowLabel(r.chosenWindow)} · PM2.5 {t('peak', 'अधिकतम')}{' '}
            {reading(r.chosenAssessment?.value)} ·{' '}
            {stateLabel(r.chosenAssessment?.coverage, language)} ·{' '}
            {stateLabel(r.chosenAssessment?.freshness, language)}
          </dd>
        </div>
        <div>
          <dt>{t('Review rule', 'समीक्षा सीमा')}</dt>
          <dd>{r.threshold} µg/m³ PM2.5</dd>
        </div>
        <div>
          <dt>
            {t('Forecast source / retrieved', 'पूर्वानुमान स्रोत / प्राप्त')}
          </dt>
          <dd>
            {r.forecastSource || t('Not retained', 'दर्ज नहीं')} ·{' '}
            {r.sourceAt || t('Not retained', 'दर्ज नहीं')} ·{' '}
            {stateLabel(r.chosenAssessment?.freshness || 'unknown', language)}
          </dd>
        </div>
        <div>
          <dt>{t('Guidance version / status', 'निर्देश संस्करण / स्थिति')}</dt>
          <dd>
            {r.policyVersion || t('Not retained', 'दर्ज नहीं')} ·{' '}
            {stateLabel(r.policyStatus || 'unknown', language)}
          </dd>
        </div>
        {r.reopenedAt && (
          <div>
            <dt>{t('Reopened at', 'समीक्षा फिर शुरू होने का समय')}</dt>
            <dd>{r.reopenedAt}</dd>
          </div>
        )}
        {r.supersededBy && (
          <div>
            <dt>{t('Replaced by record', 'बाद के रिकॉर्ड से बदला')}</dt>
            <dd>{r.supersededBy}</dd>
          </div>
        )}
        <div>
          <dt>{t('Record state / follow-through', 'रिकॉर्ड स्थिति / पालन')}</dt>
          <dd>
            {stateLabel(r.lifecycle || 'legacy', language)} ·{' '}
            {stateLabel(r.followThrough, language)}
          </dd>
        </div>
        <div>
          <dt>{t('Recorded at / ID', 'दर्ज समय / ID')}</dt>
          <dd>
            {r.at} · {r.id}
          </dd>
        </div>
        <div>
          <dt>{t('Snapshot / plan version', 'स्नैपशॉट / योजना संस्करण')}</dt>
          <dd>
            {r.snapshotId} · {r.planVersion}
          </dd>
        </div>
      </dl>
      {sessionOnly && (
        <p>
          {t(
            'Some current changes exist only in this session.',
            'कुछ वर्तमान बदलाव केवल इस सत्र में हैं।',
          )}
        </p>
      )}
      <p className="help-text">
        {t(
          'Historical evidence, not a current advisory. Regional model data cannot verify conditions at a school or street, or indoor air. PM concentrations are not official Indian AQI. The threshold and action are user choices, not an official order. Indoor/cancelled actions retain the outdoor comparison window for provenance; they do not estimate indoor exposure or exposure avoided.',
          'यह ऐतिहासिक डेटा है, वर्तमान सलाह नहीं। क्षेत्रीय मॉडल स्कूल, सड़क या अंदर की स्थिति की पुष्टि नहीं करता। PM सांद्रता आधिकारिक भारतीय AQI नहीं है। सीमा और निर्णय उपयोगकर्ता के हैं, आधिकारिक आदेश नहीं। अंदर या रद्द गतिविधियों का बाहरी समय संदर्भ के लिए रखा जाता है; अंदर के संपर्क या बचाए गए संपर्क का अनुमान नहीं किया जाता।',
        )}
      </p>
    </article>
  )
}
