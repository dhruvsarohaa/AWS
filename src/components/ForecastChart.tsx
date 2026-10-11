import { useEffect, useId, useRef, useState } from 'react'
import { clockMinutes, concentration, formatDate } from '../lib/planner.ts'
import type { Activity, ForecastPoint, Language } from '../types.ts'
import { say } from '../lib/labels.ts'

type Props = {
  points: ForecastPoint[]
  threshold: number | null
  activity?: Activity
  originalWindow?: { start: string; end: string }
  language?: Language
}
export default function ForecastChart({
  points,
  threshold,
  activity,
  originalWindow,
  language = 'en',
}: Props) {
  const uid = useId(),
    t = (en: string, hi: string) => say(language, en, hi)
  const [pollutant, setPollutant] = useState<'both' | 'pm25' | 'pm10'>('both')
  const show25 = pollutant !== 'pm10',
    show10 = pollutant !== 'pm25'
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(760)
  const [selected, setSelected] = useState(12)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, Math.round(entry.contentRect.width))),
    )
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  const height = 248,
    left = 46,
    right = 12,
    top = 20,
    bottom = 38
  const chartWidth = width - left - right,
    chartHeight = height - top - bottom
  const values = points
    .flatMap((point) => [
      show25 ? point.pm25 : null,
      show10 ? point.pm10 : null,
    ])
    .filter((value): value is number => value !== null)
  const maxValue = Math.max(
    50,
    Math.ceil(Math.max(...values, show25 ? (threshold ?? 0) : 0, 0) / 50) * 50,
  )
  const x = (hour: number) => left + (chartWidth * hour) / 24
  const y = (value: number) => top + chartHeight * (1 - value / maxValue)
  const path = (key: 'pm25' | 'pm10') =>
    points
      .map((point, index) =>
        point[key] === null
          ? ''
          : `${index === 0 || points[index - 1][key] === null ? 'M' : 'L'} ${x(index)} ${y(point[key]!)}`,
      )
      .filter(Boolean)
      .join(' ')
  const ticks = [0, 1, 2, 3, 4].map((index) => (maxValue * index) / 4)
  const hours = width < 430 ? [0, 8, 16, 24] : [0, 6, 12, 18, 24]
  const point = points[selected]
  const peak25 = Math.max(
    ...points.flatMap((row) => (row.pm25 === null ? [] : [row.pm25])),
    0,
  )
  const count = points.filter((row) => row.pm25 !== null).length

  return (
    <div ref={container} className="forecast-visual">
      <label className="chart-focus">
        {t('Chart pollutant', 'चार्ट प्रदूषक')}
        <select
          value={pollutant}
          onChange={(e) => setPollutant(e.target.value as typeof pollutant)}
        >
          <option value="both">PM2.5 + PM10</option>
          <option value="pm25">PM2.5</option>
          <option value="pm10">PM10</option>
        </select>
      </label>
      {!show25 && (
        <p className="help-text">
          {t(
            'Planning still uses PM2.5. Hiding its line does not change the review rule. The PM2.5 rule is not plotted against PM10.',
            'योजना अब भी PM2.5 पर है। रेखा छिपाने से सीमा नहीं बदलती। PM2.5 सीमा PM10 के साथ नहीं दिखाई जाती।',
          )}
        </p>
      )}
      <div className="chart-legend">
        {show25 && (
          <span>
            <i className="legend-line pm25" />
            PM2.5
          </span>
        )}
        {show10 && (
          <span>
            <i className="legend-line pm10" />
            PM10
          </span>
        )}
        {threshold !== null && (
          <span>
            <i className="legend-line threshold" />
            {t('PM2.5 review rule', 'PM2.5 समीक्षा सीमा')}:{' '}
            {concentration(threshold)}
          </span>
        )}
      </div>
      {activity && (
        <p className="chart-context">
          <span className="activity-swatch" />
          {activity.activity} · {activity.start}–{activity.end} IST
        </p>
      )}
      {originalWindow &&
        activity &&
        (originalWindow.start !== activity.start ||
          originalWindow.end !== activity.end) && (
          <p className="chart-context">
            {t('Original', 'मूल')}: {originalWindow.start}–{originalWindow.end}{' '}
            IST · {t('Proposed / chosen', 'प्रस्तावित / चुना')}:{' '}
            {activity.start}–{activity.end} IST ·{' '}
            {t(
              'filled band; original band is outlined',
              'भरा हुआ क्षेत्र; मूल क्षेत्र रेखांकित है',
            )}
          </p>
        )}
      <svg
        className="forecast-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${uid}-title ${uid}-description`}
      >
        <title id={`${uid}-title`}>
          {t(
            'Regional concentration forecast, in µg/m³',
            'क्षेत्रीय सांद्रता पूर्वानुमान, µg/m³ में',
          )}{' '}
          ·{' '}
          {pollutant === 'both'
            ? 'PM2.5 + PM10'
            : pollutant === 'pm25'
              ? 'PM2.5'
              : 'PM10'}
        </title>
        <desc id={`${uid}-description`} lang="en">
          Full day from midnight to midnight in India time. PM2.5 is available
          for {count} of 24 hours
          {count
            ? `, with a forecast peak of ${concentration(peak25)} micrograms per cubic metre`
            : ''}
          . Use the hour selector or the hourly table below for individual
          values. Gaps mean unavailable data.
        </desc>
        {activity && (
          <rect
            className="activity-shading"
            x={x(clockMinutes(activity.start) / 60)}
            y={top}
            width={Math.max(
              0,
              x(clockMinutes(activity.end) / 60) -
                x(clockMinutes(activity.start) / 60),
            )}
            height={chartHeight}
          />
        )}
        {originalWindow &&
          activity &&
          (originalWindow.start !== activity.start ||
            originalWindow.end !== activity.end) && (
            <rect
              className="original-shading"
              x={x(clockMinutes(originalWindow.start) / 60)}
              y={top}
              width={Math.max(
                0,
                x(clockMinutes(originalWindow.end) / 60) -
                  x(clockMinutes(originalWindow.start) / 60),
              )}
              height={chartHeight}
            />
          )}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={y(tick)}
              y2={y(tick)}
              className="chart-gridline"
            />
            <text
              x={left - 9}
              y={y(tick) + 5}
              textAnchor="end"
              className="chart-label"
            >
              {Math.round(tick)}
            </text>
          </g>
        ))}
        {threshold !== null && show25 && (
          <line
            x1={left}
            x2={width - right}
            y1={y(threshold)}
            y2={y(threshold)}
            className="chart-threshold"
          />
        )}
        {show10 && <path d={path('pm10')} className="chart-line chart-pm10" />}
        {show25 && <path d={path('pm25')} className="chart-line chart-pm25" />}
        {(['pm25', 'pm10'] as const).flatMap((key) =>
          points.map((p, i) =>
            (key === 'pm25' ? show25 : show10) &&
            p[key] !== null &&
            (i === 0 || points[i - 1][key] === null) &&
            (i === points.length - 1 || points[i + 1][key] === null) ? (
              <circle
                key={`${key}-${i}`}
                cx={x(i)}
                cy={y(p[key]!)}
                r={4}
                className={`chart-point-${key}`}
              />
            ) : null,
          ),
        )}
        <line
          x1={x(selected)}
          x2={x(selected)}
          y1={top}
          y2={height - bottom}
          className="chart-crosshair"
        />
        {show25 && point?.pm25 !== null && point?.pm25 !== undefined && (
          <circle
            cx={x(selected)}
            cy={y(point.pm25)}
            r={5}
            className="chart-point-pm25"
          />
        )}
        {show10 && point?.pm10 !== null && point?.pm10 !== undefined && (
          <circle
            cx={x(selected)}
            cy={y(point.pm10)}
            r={5}
            className="chart-point-pm10"
          />
        )}
        {hours.map((hour) => (
          <text
            key={hour}
            x={x(hour)}
            y={height - 10}
            textAnchor={hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'}
            className="chart-label"
          >
            {String(hour).padStart(2, '0')}:00
          </text>
        ))}
        <rect
          x={left}
          y={top}
          width={chartWidth}
          height={chartHeight}
          fill="transparent"
          aria-hidden="true"
          className="chart-touch-area"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setSelected(
              Math.max(
                0,
                Math.min(
                  23,
                  Math.round(((event.clientX - rect.left) / rect.width) * 24),
                ),
              ),
            )
          }}
        />
      </svg>
      <div className="hour-inspector">
        <label htmlFor={`${uid}-hour`}>
          {t('Inspect an hour', 'एक घंटे का डेटा देखें')}
          <select
            id={`${uid}-hour`}
            value={selected}
            onChange={(event) => setSelected(Number(event.target.value))}
          >
            {points.map((row, index) => (
              <option value={index} key={row.time}>
                {formatDate(row.time, {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}{' '}
                IST
              </option>
            ))}
          </select>
        </label>
        <dl aria-live="polite">
          <div>
            <dt>PM2.5 · µg/m³</dt>
            <dd>{concentration(point?.pm25)}</dd>
          </div>
          <div>
            <dt>PM10 · µg/m³</dt>
            <dd>{concentration(point?.pm10)}</dd>
          </div>
        </dl>
      </div>
      <details className="hourly-details">
        <summary>
          {t('View all hourly values', 'सभी प्रति घंटा मान देखें')}
        </summary>
        <table>
          <caption>
            {t(
              'Regional model concentrations · µg/m³ · IST. Source: Open-Meteo / CAMS Global. Missing values are not zero.',
              'क्षेत्रीय मॉडल सांद्रता · µg/m³ · IST। स्रोत: Open-Meteo / CAMS Global। खाली मान शून्य नहीं हैं।',
            )}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t('Time', 'समय')}</th>
              <th scope="col">PM2.5</th>
              <th scope="col">PM10</th>
              <th scope="col">{t('PM2.5 rule', 'PM2.5 सीमा')}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((row) => (
              <tr key={row.time}>
                <th scope="row">{row.time.slice(11, 16)}</th>
                <td>{concentration(row.pm25)}</td>
                <td>{concentration(row.pm10)}</td>
                <td>
                  {row.pm25 === null
                    ? t('No data', 'डेटा नहीं')
                    : threshold === null
                      ? t('Preview', 'पूर्वावलोकन')
                      : row.pm25 > threshold
                        ? t('Above rule', 'सीमा से ऊपर')
                        : t('At or below rule', 'सीमा के बराबर या नीचे')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}
