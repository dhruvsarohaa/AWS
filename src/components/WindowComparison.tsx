import { useState } from 'react'
import ForecastChart from './ForecastChart.tsx'
import ConcentrationTime from './ConcentrationTime.tsx'
import type { ActivityView } from '../lib/activity-view.ts'
import type { DashboardData, Language } from '../types.ts'
import {
  clockMinutes,
  concentration,
  FORECAST_MAX_AGE,
  formatTimestamp,
  pointsForDate,
  timestampState,
} from '../lib/planner.ts'
import { windowMean } from '../lib/time-search.ts'
import { say } from '../lib/labels.ts'
export default function WindowComparison({
  view,
  data,
  date,
  now,
  language,
  disabled,
  onRecord,
}: {
  view: ActivityView
  data: DashboardData | null
  date: string
  now: number
  language: Language
  disabled: boolean
  onRecord: (start: string, end: string) => void
}) {
  const [selection, setSelection] = useState<string | null>(null)
  const t = (en: string, hi: string) => say(language, en, hi),
    points = pointsForDate(data?.forecast?.points || [], date)
  const selected = view.alternatives.find((o) => o.start === selection)
  const fresh =
    timestampState(data?.forecast?.fetchedAt, now, FORECAST_MAX_AGE) === 'fresh'
  const duration = clockMinutes(view.end) - clockMinutes(view.start)
  return (
    <details className="window-comparison">
      <summary>
        {t(
          'Compare original & allowed alternatives',
          'मूल और अनुमत विकल्पों की तुलना',
        )}
      </summary>
      <p className="help-text">
        {date} · IST · {duration} {t('minutes each', 'मिनट प्रत्येक')} ·{' '}
        {t('Allowed', 'अनुमत')}: {view.allowedStart || view.start}–
        {view.allowedEnd || view.end}.{' '}
        {t(
          'Peak first, then mean, then earlier time. Only complete future alternatives qualify.',
          'पहले अधिकतम, फिर औसत, फिर पहले समय के अनुसार। केवल पूरे डेटा वाले आगामी विकल्प शामिल हैं।',
        )}
      </p>
      <p className="help-text">
        {data?.forecast?.source ||
          t('Forecast unavailable', 'पूर्वानुमान उपलब्ध नहीं')}{' '}
        · {t('Retrieved', 'प्राप्त')}:{' '}
        {formatTimestamp(data?.forecast?.fetchedAt, now)} ·{' '}
        {t('Your PM2.5 rule', 'आपकी PM2.5 सीमा')}: {view.contextPlan.threshold}{' '}
        µg/m³
      </p>
      <div className="comparison-grid">
        <article
          className={`comparison-option original ${!selected ? 'selected' : ''}`}
        >
          <h4>
            {view.start}–{view.end}
          </h4>
          <p className="section-meta">{t('Original plan', 'मूल योजना')}</p>
          <dl>
            <div>
              <dt>{t('Model PM2.5 peak', 'मॉडल PM2.5 अधिकतम')}</dt>
              <dd>{concentration(view.value)} µg/m³</dd>
            </div>
            <div>
              <dt>{t('Mean / coverage', 'औसत / डेटा')}</dt>
              <dd>
                {concentration(windowMean(points, view.start, view.end))} µg/m³
                · {view.available}/{view.expected}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="text-button"
            onClick={() => setSelection(null)}
          >
            {t('Restore original preview', 'मूल पूर्वावलोकन लौटाएं')}
          </button>
        </article>
        {view.alternatives.map((option) => (
          <article
            key={option.start}
            className={`comparison-option ${selected?.start === option.start ? 'selected' : ''}`}
          >
            <h4>
              {option.start}–{option.end}
            </h4>
            <p className="section-meta">
              {t('Feasible alternative', 'व्यावहारिक विकल्प')}
            </p>
            <dl>
              <div>
                <dt>{t('Model PM2.5 peak', 'मॉडल PM2.5 अधिकतम')}</dt>
                <dd>{concentration(option.value)} µg/m³</dd>
              </div>
              <div>
                <dt>{t('Mean / coverage', 'औसत / डेटा')}</dt>
                <dd>
                  {concentration(option.mean)} µg/m³ · {t('complete', 'पूरा')}
                </dd>
              </div>
            </dl>
            <p className="help-text">
              {option.start < view.start
                ? t('Earlier than the original', 'मूल समय से पहले')
                : t('Later than the original', 'मूल समय से बाद')}{' '}
              ·{' '}
              {option.review
                ? t('still above your rule', 'अब भी आपकी सीमा से ऊपर')
                : t('at or below your rule', 'आपकी सीमा के बराबर या नीचे')}
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={disabled || !fresh}
              aria-pressed={selected?.start === option.start}
              onClick={() => setSelection(option.start)}
            >
              {t('Preview this window', 'इस समय का पूर्वावलोकन')}
            </button>
          </article>
        ))}
      </div>
      {!view.alternatives.length && (
        <p className="coverage-warning">
          {!fresh
            ? t(
                'Refresh the regional forecast before comparing windows.',
                'समय की तुलना से पहले क्षेत्रीय पूर्वानुमान रीफ़्रेश करें।',
              )
            : view.coverage !== 'complete'
              ? t(
                  'The original window has incomplete data. A lower-peak comparison is unavailable until both windows have complete data.',
                  'मूल समय का डेटा अधूरा है। दोनों समय का पूरा डेटा मिलने तक कम अधिकतम मान की तुलना उपलब्ध नहीं है।',
                )
              : duration < 15 || duration > 240
                ? t(
                    'Time search supports durations from 15 to 240 minutes. This activity remains available for manual review.',
                    'समय खोज 15 से 240 मिनट की अवधि के लिए है। यह गतिविधि व्यक्तिगत समीक्षा के लिए उपलब्ध है।',
                  )
                : t(
                    'No complete lower-peak future window fits the allowed times. Review the constraints or choose another response. Missing values are not filled in.',
                    'अनुमत समय में पूरे डेटा वाला कम अधिकतम मान का आगामी विकल्प नहीं है। सीमाएं देखें या दूसरा निर्णय चुनें। खाली मान भरे नहीं जाते।',
                  )}
        </p>
      )}
      {selected && fresh && (
        <section
          className="chosen-preview"
          aria-label={t(
            'Proposed time preview',
            'प्रस्तावित समय का पूर्वावलोकन',
          )}
        >
          <div className="section-heading">
            <h3>
              {t('Proposed · not recorded', 'प्रस्तावित · दर्ज नहीं')}{' '}
              {selected.start}–{selected.end}
            </h3>
            <button
              type="button"
              className="text-button"
              onClick={() => setSelection(null)}
            >
              {t('Cancel preview', 'पूर्वावलोकन रद्द करें')}
            </button>
          </div>
          <ForecastChart
            points={points}
            threshold={view.contextPlan.threshold}
            activity={{ ...view, start: selected.start, end: selected.end }}
            originalWindow={{ start: view.start, end: view.end }}
            language={language}
          />
          <ConcentrationTime
            data={data}
            date={date}
            start={view.start}
            end={view.end}
            chosen={selected}
            language={language}
            now={now}
          />
          <button
            type="button"
            className="button primary"
            disabled={disabled}
            onClick={() => onRecord(selected.start, selected.end)}
          >
            {t('Continue to decision', 'निर्णय दर्ज करने के लिए आगे बढ़ें')}
          </button>
        </section>
      )}
      <p className="help-text">
        {t(
          'Same date, regional model and duration. Previewing changes no saved record. The model has roughly 45 km cells and three-hour source steps; these comparisons do not guarantee safe air.',
          'एक ही तारीख, क्षेत्रीय मॉडल और अवधि। पूर्वावलोकन सहेजे गए रिकॉर्ड को नहीं बदलता। मॉडल लगभग 45 किमी और तीन घंटे के स्रोत अंतराल पर है; तुलना सुरक्षित हवा की गारंटी नहीं है।',
        )}
      </p>
    </details>
  )
}
