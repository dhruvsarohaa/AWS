import { useState } from 'react'
import type { DashboardData, Language, Pollutant } from '../types.ts'
import {
  integrate,
  modelIntervals,
  periodWindow,
  POLLUTANTS,
} from '../lib/periods.ts'
import { say } from '../lib/labels.ts'
import { formatTimestamp } from '../lib/planner.ts'
export default function PollutantExplorer({
  data,
  date,
  language,
  now,
}: {
  data: DashboardData | null
  date: string
  language: Language
  now: number
}) {
  const [key, setKey] = useState<Pollutant>('pm25'),
    [hours, setHours] = useState(8),
    [start, setStart] = useState('06:00')
  const intervals = modelIntervals(data, key),
    window = periodWindow(date, start, hours),
    a = window?.start || '',
    b = window?.end || '',
    result = integrate(intervals, a, b)
  const t = (en: string, hi: string) => say(language, en, hi),
    shown = intervals.filter((i) => i.start.slice(0, 10) === date)
  const peak = Math.max(1, ...shown.map((i) => i.value ?? 0)),
    dayStart = Date.parse(`${date}T00:00:00+05:30`)
  return (
    <section
      id="pollutant-tools"
      tabIndex={-1}
      className="card pollutant-explorer"
    >
      <h2>{t('Pollutants & period comparison', 'प्रदूषक और अवधि की तुलना')}</h2>
      <p className="section-meta">
        {t('Regional model · concentrations', 'क्षेत्रीय मॉडल · सांद्रता')}
      </p>
      <div
        className="button-row"
        role="group"
        aria-label={t('Pollutant', 'प्रदूषक')}
      >
        {(Object.keys(POLLUTANTS) as Pollutant[]).map((p) => (
          <button
            type="button"
            key={p}
            aria-pressed={p === key}
            className={`button ${p === key ? 'primary' : 'secondary'}`}
            onClick={() => setKey(p)}
          >
            {POLLUTANTS[p]}
          </button>
        ))}
      </div>
      <div className="r2-form-row">
        <label>
          {t('Start (IST)', 'आरंभ (IST)')}
          <input
            type="time"
            value={start}
            required
            onInput={(e) => setStart(e.currentTarget.value)}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          {t('Period', 'अवधि')}
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            {[1, 8, 24].map((h) => (
              <option key={h} value={h}>
                {h} {t('hours', 'घंटे')}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!window && (
        <p role="alert" className="coverage-warning">
          {t(
            'Choose a valid date, start time and period before comparing.',
            'तुलना से पहले सही तिथि, आरंभ समय और अवधि चुनें।',
          )}
        </p>
      )}
      <p className="metric-value">
        {result.mean === null ? '—' : result.mean.toFixed(1)}{' '}
        <small>µg/m³ · {POLLUTANTS[key]}</small>
      </p>
      <p>
        {t('Overlap-weighted model estimate', 'समय भारित मॉडल अनुमान')} ·{' '}
        {result.complete
          ? t('Complete', 'पूरा')
          : t('Incomplete: mean withheld', 'अधूरा: औसत नहीं दिखाया गया')}{' '}
        · {result.covered.toFixed(2)}/{hours} h · {result.count}{' '}
        {t('included intervals', 'शामिल अंतराल')}
      </p>
      <p className="help-text">
        {date} {start} → {formatTimestamp(b, now)} ·{' '}
        {data?.forecast?.source || t('No model data', 'मॉडल डेटा नहीं')} ·{' '}
        {t('Retrieved', 'प्राप्त')}{' '}
        {formatTimestamp(data?.forecast?.fetchedAt, now)}
      </p>
      <div className="recap-grid">
        {[1, 8, 24].map((h) => {
          const comparison = periodWindow(date, start, h)
          const p = integrate(
            intervals,
            comparison?.start || '',
            comparison?.end || '',
          )
          return (
            <article key={h}>
              <strong>{p.mean === null ? '—' : p.mean.toFixed(1)}</strong>
              <span>
                {h} h · µg/m³ · {p.covered.toFixed(2)}/{h} h{' '}
                {t('covered', 'उपलब्ध')} ·{' '}
                {p.complete ? t('Complete', 'पूरा') : t('Incomplete', 'अधूरा')}
              </span>
            </article>
          )
        })}
      </div>
      <p className="help-text">
        {t(
          'Each hourly API sample is held for one hour for this display estimate. The underlying global model has ~45 km grid cells and three-hour source steps. Missing intervals are not filled. These are not official AQI, observed hourly means, health limits or the PM2.5 peak rule used for your plan.',
          'दिखाने के अनुमान में हर घंटे के नमूने को एक घंटे रखा गया है। मूल मॉडल लगभग 45 किमी और तीन घंटे का है। खाली अंतराल नहीं भरे जाते। यह आधिकारिक AQI, मापन, स्वास्थ्य सीमा या योजना की PM2.5 अधिकतम सीमा नहीं है।',
        )}
      </p>
      <details>
        <summary>
          {t('Included intervals & calculation', 'शामिल अंतराल और गणना')}
        </summary>
        <p>Σ(concentration × overlapping hours) / requested hours; µg/m³.</p>
        <div className="table-scroll">
          <table>
            <caption>
              {POLLUTANTS[key]} · {date} · µg/m³
            </caption>
            <thead>
              <tr>
                <th>{t('Interval (IST)', 'अंतराल (IST)')}</th>
                <th>{t('Value', 'मात्रा')}</th>
              </tr>
            </thead>
            <tbody>
              {result.included.map((i) => (
                <tr key={i.start}>
                  <td>
                    {formatTimestamp(i.start, now)} →{' '}
                    {formatTimestamp(i.end, now)}
                  </td>
                  <td>{i.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {shown.some((i) => i.value !== null) ? (
        <>
          <svg
            viewBox="0 0 600 155"
            className="pollutant-spark"
            role="img"
            aria-label={t(
              `${POLLUTANTS[key]} regional model samples for ${date}. Values in the table below.`,
              `${date} के ${POLLUTANTS[key]} क्षेत्रीय मॉडल नमूने। मान नीचे तालिका में हैं।`,
            )}
          >
            <text x="8" y="12" fontSize="10">
              {POLLUTANTS[key]} µg/m³ · {t('Scale top', 'ऊपरी सीमा')}{' '}
              {peak.toFixed(1)}
            </text>
            {shown.map((i) =>
              i.value !== null ? (
                i.value === 0 ? (
                  <circle
                    key={i.start}
                    cx={((Date.parse(i.start) - dayStart) / 3600000) * 24 + 17}
                    cy={140}
                    r={3}
                    fill="currentColor"
                  />
                ) : (
                  <rect
                    key={i.start}
                    x={((Date.parse(i.start) - dayStart) / 3600000) * 24 + 8}
                    width={18}
                    y={140 - (i.value / peak) * 120}
                    height={(i.value / peak) * 120}
                    fill="currentColor"
                  />
                )
              ) : null,
            )}
            <text x="8" y="153" fontSize="10">
              00:00 IST
            </text>
            <text x="540" y="153" fontSize="10">
              24:00 IST
            </text>
          </svg>
          <p className="help-text">
            {t(
              'Blank hour positions are missing. Baseline dots are valid zero values.',
              'खाली घंटे में डेटा नहीं। नीचे के बिंदु मान्य शून्य हैं।',
            )}
          </p>
          <details>
            <summary>
              {t(
                'All model samples (accessible table)',
                'सभी मॉडल नमूने (तालिका)',
              )}
            </summary>
            <div className="table-scroll">
              <table>
                <caption>
                  {POLLUTANTS[key]} ·{' '}
                  {t(
                    'Model samples, not station measurements',
                    'मॉडल नमूने, स्टेशन मापन नहीं',
                  )}
                </caption>
                <thead>
                  <tr>
                    <th>IST</th>
                    <th>µg/m³</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => (
                    <tr key={i.start}>
                      <td>{i.start.slice(11, 16)}</td>
                      <td>{i.value ?? t('Missing', 'अनुपलब्ध')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="empty-message">
          {t(
            'No verified values for this pollutant/date. Older caches can contain only particulate matter.',
            'इस प्रदूषक/तिथि के सत्यापित मान नहीं। पुराने संग्रह में केवल कण हो सकते हैं।',
          )}
        </p>
      )}
    </section>
  )
}
