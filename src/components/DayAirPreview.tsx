import { useId } from 'react'
import type { ForecastPoint, Language } from '../types.ts'
import { concentration } from '../lib/planner.ts'
import { say } from '../lib/labels.ts'

export default function DayAirPreview({
  points,
  language,
  loading,
  retained,
  onEvidence,
}: {
  points: ForecastPoint[]
  language: Language
  loading: boolean
  retained: boolean
  onEvidence: () => void
}) {
  const id = useId(),
    t = (en: string, hi: string) => say(language, en, hi)
  const values = points.flatMap((p) => (p.pm25 === null ? [] : [p.pm25]))
  const peak = values.length ? Math.max(...values) : null
  const top = Math.max(25, peak ?? 0)
  const x = (index: number) => 8 + (index / 23) * 304
  const y = (value: number) => 68 - (value / top) * 52
  const path = points
    .map((p, i) =>
      p.pm25 === null
        ? ''
        : `${i === 0 || points[i - 1].pm25 === null ? 'M' : 'L'}${x(i)},${y(p.pm25)}`,
    )
    .filter(Boolean)
    .join(' ')
  return (
    <section className="day-air-preview" aria-labelledby={id}>
      <div className="air-preview-heading">
        <h2 id={id}>{t('The air ahead', 'आने वाले समय की हवा')}</h2>
        <span className="air-model-label">
          {t(
            retained ? 'Retained forecast' : 'Regional forecast',
            retained ? 'सहेजा पूर्वानुमान' : 'क्षेत्रीय पूर्वानुमान',
          )}
        </span>
      </div>
      <div className="air-preview-value">
        <strong>{peak === null ? '—' : concentration(peak)}</strong>
        <span>µg/m³</span>
        <small>{t('Available PM2.5 peak', 'उपलब्ध PM2.5 उच्चतम मान')}</small>
      </div>
      {values.length ? (
        <div className="air-sparkline">
          <svg viewBox="0 0 320 80" aria-hidden="true">
            {[20, 44, 68].map((v) => (
              <path key={v} className="air-gridline" d={`M8 ${v}H312`} />
            ))}
            <path className="air-line" d={path} />
            {points.map((p, i) =>
              p.pm25 !== null &&
              (i === 0 ||
                i === 23 ||
                points[i - 1].pm25 === null ||
                points[i + 1]?.pm25 === null) ? (
                <circle
                  className="air-dot"
                  key={p.time}
                  cx={x(i)}
                  cy={y(p.pm25)}
                  r="2.5"
                />
              ) : null,
            )}
          </svg>
          <div className="air-axis">
            <span>00:00</span>
            <span>12:00</span>
            <span>23:00 IST</span>
          </div>
        </div>
      ) : (
        <p className="air-preview-empty">
          {t(
            loading
              ? 'Fetching the forecast…'
              : 'No PM2.5 values available for this date.',
            loading
              ? 'पूर्वानुमान लोड हो रहा है…'
              : 'इस तारीख के PM2.5 मान उपलब्ध नहीं हैं।',
          )}
        </p>
      )}
      <div className="air-preview-footer">
        <span>
          {values.length}/24 {t('hours available', 'घंटे उपलब्ध')}
          <small>
            {t(
              'Model output · not measured local air',
              'मॉडल डेटा · स्थानीय माप नहीं',
            )}
          </small>
        </span>
        <button
          type="button"
          className="air-evidence-link"
          onClick={onEvidence}
          aria-label={t('Explore hourly evidence', 'प्रति घंटा डेटा देखें')}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
        </button>
      </div>
    </section>
  )
}
