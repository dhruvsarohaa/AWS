import { useCallback, useEffect, useRef, useState } from 'react'
import type { DashboardData, Language } from '../types.ts'
import type { HistoryPage, RetainedRun } from '../lib/history.ts'
import {
  validHistory,
  validHistoryRange,
  historySensors,
} from '../lib/history.ts'
import { addDays, dateInIndia, formatTimestamp } from '../lib/planner.ts'
import { say } from '../lib/labels.ts'
import { integrate, periodWindow } from '../lib/periods.ts'
import PollutantExplorer from './PollutantExplorer.tsx'
const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
export default function HistoryTrends({
  data,
  language,
  active,
  now,
}: {
  data: DashboardData
  language: Language
  active: boolean
  now: number
}) {
  const [from, setFrom] = useState(addDays(dateInIndia(), -6)),
    [to, setTo] = useState(dateInIndia()),
    [kind, setKind] = useState<'runs' | 'observations'>('runs'),
    [sensor, setSensor] = useState(''),
    [runs, setRuns] = useState<RetainedRun[]>([]),
    [catalogCursor, setCatalogCursor] = useState<string | null>(null),
    [page, setPage] = useState<HistoryPage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [observationHours, setObservationHours] = useState(8),
    [modelDate, setModelDate] = useState(dateInIndia())
  const abort = useRef<AbortController | null>(null),
    generation = useRef(0),
    t = (en: string, hi: string) => say(language, en, hi),
    sensors = historySensors(data),
    rangeValid = validHistoryRange(from, to),
    sensorValid = sensors.some((m) => m.sensorId === sensor)
  const cancelRequests = useCallback(() => {
    generation.current++
    abort.current?.abort()
  }, [])
  useEffect(() => {
    if (!active) {
      cancelRequests()
      // Finish a suspended request so returning to History can load again.
      // oxlint-disable-next-line react/set-state-in-effect
      setBusy(false)
    }
    return cancelRequests
  }, [active, cancelRequests])
  function reset() {
    generation.current++
    abort.current?.abort()
    setPage(null)
    setRuns([])
    setCatalogCursor(null)
    setError('')
    setBusy(false)
  }
  async function load(
    type: HistoryPage['kind'] = kind,
    run?: string,
    cursor?: string,
  ) {
    if (!active || !rangeValid || (type === 'observations' && !sensorValid))
      return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const id = ++generation.current
    setBusy(true)
    setError('')
    if (!cursor) setPage(null)
    const timer = setTimeout(() => controller.abort('timeout'), 15000)
    try {
      const query = new URLSearchParams({
        lat: String(data.location.latitude),
        lon: String(data.location.longitude),
        city: data.location.name,
        state: data.location.state,
        from,
        to,
        kind: type,
      })
      if (run) query.set('run', run)
      if (type === 'observations') query.set('sensor', sensor)
      if (data.location.detected) query.set('mode', 'coordinates')
      if (cursor) query.set('cursor', cursor)
      const response = await fetch(`${API_BASE}/api/history?${query}`, {
        signal: controller.signal,
      })
      const body = await response.json()
      if (!response.ok)
        throw new Error(
          typeof body.error === 'string'
            ? body.error
            : 'History request failed.',
        )
      if (id !== generation.current) return
      if (!validHistory(body, data, type, from, to))
        throw new Error(
          'Unsupported history response. Existing journal data is unchanged.',
        )
      if (
        (type === 'forecast' && body.run?.id !== run) ||
        (type === 'observations' && body.station?.sensorId !== sensor)
      )
        throw new Error(
          'History response is for a different selected run or sensor.',
        )
      setPage(body)
      if (type === 'runs') {
        setRuns(body.runs || [])
        setCatalogCursor(body.nextCursor)
      }
      if (type === 'forecast' && body.forecast?.points.length)
        setModelDate(body.forecast.points[0].time.slice(0, 10))
    } catch (e) {
      if (
        id === generation.current &&
        (!controller.signal.aborted || controller.signal.reason === 'timeout')
      )
        setError(e instanceof Error ? e.message : 'History unavailable.')
    } finally {
      clearTimeout(timer)
      if (id === generation.current) setBusy(false)
    }
  }
  const obs = page?.kind === 'observations' ? page.observations || [] : [],
    intervals = obs
      .filter(
        (m) =>
          m.period &&
          m.statistic === 'mean' &&
          m.unit === 'µg/m³' &&
          m.sensorId === sensor,
      )
      .map((m) => ({
        start: m.period!.start,
        end: m.period!.end,
        value: m.value,
      })),
    ending = periodWindow(to, '18:00', 1)?.start,
    periodEnd = ending || '',
    periodStart = ending
      ? new Date(Date.parse(ending) - observationHours * 3600000).toISOString()
      : '',
    stat = integrate(intervals, periodStart, periodEnd)
  return (
    <section id="evidence-trends" tabIndex={-1} className="card history-trends">
      <h2>{t('Evidence trends', 'डेटा का इतिहास')}</h2>
      <p className="section-meta">
        {t(
          'Retained data · no backfilled model claim',
          'रखा गया डेटा · पुराने मॉडल का अनुमान नहीं',
        )}
      </p>
      <p className="help-text">
        {t(
          'Choose a range up to 31 days. Model runs are cataloged prospectively by first retrieval; issuance is unknown when the provider does not supply it. Observations come from separately reconciled OpenAQ sensor-hour records. Missing dates and source changes are not joined or averaged.',
          '31 दिन तक अवधि चुनें। मॉडल पहली प्राप्ति से रखा जाता है; स्रोत न दे तो जारी समय अज्ञात है। मापन अलग OpenAQ सेंसर रिकॉर्ड से हैं। खाली दिन या अलग स्रोत नहीं मिलाए जाते।',
        )}
      </p>
      <div className="r2-form-row">
        <label>
          {t('From', 'से')}
          <input
            type="date"
            value={from}
            onInput={(e) => {
              reset()
              setFrom(e.currentTarget.value)
            }}
            onChange={(e) => {
              reset()
              setFrom(e.target.value)
            }}
          />
        </label>
        <label>
          {t('Through', 'तक')}
          <input
            type="date"
            value={to}
            onInput={(e) => {
              reset()
              setTo(e.currentTarget.value)
            }}
            onChange={(e) => {
              reset()
              setTo(e.target.value)
            }}
          />
        </label>
        <label>
          {t('Series', 'श्रृंखला')}
          <select
            value={kind}
            onChange={(e) => {
              reset()
              setKind(e.target.value as typeof kind)
            }}
          >
            <option value="runs">{t('Retained model runs', 'रखे मॉडल')}</option>
            <option value="observations">
              {t('Station observations (PM2.5)', 'स्टेशन मापन (PM2.5)')}
            </option>
          </select>
        </label>
        {kind === 'observations' && (
          <label>
            {t('Returned sensor', 'मिला सेंसर')}
            <select
              value={sensor}
              onChange={(e) => {
                reset()
                setSensor(e.target.value)
              }}
            >
              <option value="">{t('Select a sensor', 'सेंसर चुनें')}</option>
              {sensors.map((m) => (
                <option key={m.sensorId} value={m.sensorId}>
                  {m.station} · {m.sensorId}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <button
        type="button"
        className="button secondary"
        disabled={
          busy ||
          !active ||
          !rangeValid ||
          (kind === 'observations' && !sensorValid)
        }
        onClick={() => void load()}
      >
        {t('Load retained evidence', 'रखे डेटा को लोड करें')}
      </button>
      {!rangeValid && (
        <p role="alert" className="coverage-warning">
          {t(
            'Choose valid dates in order, covering at most 31 dates.',
            'सही तिथियां क्रम में चुनें; अधिकतम 31 तिथियां।',
          )}
        </p>
      )}
      {kind === 'observations' && sensor && !sensorValid && (
        <p role="alert" className="coverage-warning">
          {t(
            'This sensor is no longer in the returned catalog. Select an available sensor.',
            'यह सेंसर अब मिले संग्रह में नहीं है। उपलब्ध सेंसर चुनें।',
          )}
        </p>
      )}
      <p role="status">{busy ? t('Loading…', 'लोड हो रहा…') : ''}</p>
      {error && (
        <p role="alert" className="coverage-warning">
          {error}
        </p>
      )}
      {page?.kind === 'runs' && page.status?.message && (
        <p className="coverage-warning">{page.status.message}</p>
      )}
      {page?.status?.checkedAt && (
        <p className="help-text">
          {t('Reconciliation checked', 'मिलान जांचा गया')}:{' '}
          {formatTimestamp(page.status.checkedAt, now)}
        </p>
      )}
      {kind === 'runs' && runs.length > 0 && (
        <ul className="retained-runs">
          {runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => void load('forecast', r.id)}
              >
                {t('Retrieved', 'प्राप्त')}{' '}
                {formatTimestamp(r.retrievedAt, now)} · {r.id.slice(0, 8)}
              </button>
              <small>
                {r.source} · {t('Issued', 'जारी')}{' '}
                {r.issuedAt
                  ? formatTimestamp(r.issuedAt, now)
                  : t('Unknown', 'अज्ञात')}
              </small>
            </li>
          ))}
        </ul>
      )}
      {page?.kind === 'forecast' && page.forecast && (
        <>
          <p>
            {t('Frozen retained run', 'स्थिर रखा मॉडल')}:{' '}
            {page.run?.id.slice(0, 8)} · {t('First retrieved', 'पहली प्राप्ति')}{' '}
            {formatTimestamp(page.run?.retrievedAt, now)}
          </p>
          <label>
            {t('Valid date from this run', 'इस मॉडल की तिथि')}
            <select
              value={modelDate}
              onChange={(e) => setModelDate(e.target.value)}
            >
              {[
                ...new Set(
                  page.forecast.points.map((p) => p.time.slice(0, 10)),
                ),
              ].map((d) => (
                <option value={d} key={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <PollutantExplorer
            data={{ ...data, forecast: page.forecast }}
            date={modelDate}
            language={language}
            now={now}
          />
        </>
      )}
      {page?.kind === 'observations' && (
        <>
          {page.status?.message && (
            <p className="coverage-warning">{page.status.message}</p>
          )}
          <p>
            {page.station?.station} · {page.station?.source} · PM2.5 · µg/m³ ·{' '}
            {t('Reconciliation status', 'मिलान स्थिति')}:{' '}
            {page.status?.status ||
              t('No reconciliation recorded', 'मिलान रिकॉर्ड नहीं')}
          </p>
          {obs.length > 0 && (
            <>
              <p className="help-text">
                {t(
                  'Retained PM2.5 observations: bars follow actual time; blank positions are gaps. This page only, no connecting line or interpolation.',
                  'रखे PM2.5 मापन: वास्तविक समय के अनुसार बिंदु; खाली स्थान में डेटा नहीं। केवल यह पृष्ठ, कोई जोड़ती रेखा या अनुमान नहीं।',
                )}
              </p>
              <svg
                viewBox="0 0 620 170"
                className="pollutant-spark"
                role="img"
                aria-label={t(
                  `PM2.5 historical observations in µg/m³, ${from} through ${to}; exact values and periods in table below.`,
                  `PM2.5 के पुराने मापन µg/m³ में, ${from} से ${to}; सही मान और अवधि नीचे तालिका में हैं।`,
                )}
              >
                <text x="8" y="14" fontSize="10">
                  PM2.5 µg/m³ · {from} → {to}
                </text>
                {obs.map((m, i) => {
                  const start = Date.parse(`${from}T00:00:00+05:30`),
                    end = Date.parse(`${to}T23:59:59+05:30`),
                    time = Date.parse(m.period?.end || m.observedAt || ''),
                    x = 10 + ((time - start) / (end - start)) * 600,
                    height =
                      (m.value / Math.max(1, ...obs.map((o) => o.value))) * 125
                  return Number.isFinite(x) ? (
                    m.value === 0 ? (
                      <circle
                        key={m.id || i}
                        cx={Math.min(609, Math.max(10, x))}
                        cy={155}
                        r={3}
                        fill="currentColor"
                      />
                    ) : (
                      <rect
                        key={m.id || i}
                        x={Math.min(609, Math.max(10, x))}
                        y={155 - height}
                        width="2"
                        height={height}
                        fill="currentColor"
                      />
                    )
                  ) : null
                })}
              </svg>
            </>
          )}
          <label>
            {t(
              'Mean period ending at 18:00 IST on through date',
              'अंतिम तिथि 18:00 IST तक औसत अवधि',
            )}
            <select
              value={observationHours}
              onChange={(e) => setObservationHours(Number(e.target.value))}
            >
              {[1, 8, 24].map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </label>
          <p>
            {t('Period mean', 'अवधि औसत')}:{' '}
            {stat.mean === null ? '—' : stat.mean.toFixed(1)} µg/m³ ·{' '}
            {stat.covered.toFixed(2)}/{observationHours} h · {stat.count}{' '}
            {t('included intervals', 'शामिल अंतराल')}.{' '}
            {t(
              'Incomplete or overlapping intervals withhold the mean. Only this sensor and mean statistic are included; no model values enter this average.',
              'अधूरे या दोहरे अंतराल में औसत नहीं। केवल इस सेंसर का औसत शामिल; मॉडल मान नहीं।',
            )}
          </p>
          <div className="table-scroll">
            <table>
              <caption>
                {t(
                  'This page only; gaps are missing evidence',
                  'केवल यह पृष्ठ; खाली समय में डेटा नहीं',
                )}
              </caption>
              <thead>
                <tr>
                  <th>{t('Observed period (IST)', 'मापन अवधि (IST)')}</th>
                  <th>PM2.5 µg/m³</th>
                  <th>{t('First retrieved', 'पहली प्राप्ति')}</th>
                </tr>
              </thead>
              <tbody>
                {obs.map((m, i) => (
                  <tr key={m.id || i}>
                    <td>
                      {formatTimestamp(m.period?.start, now)} →{' '}
                      {formatTimestamp(m.period?.end || m.observedAt, now)}
                    </td>
                    <td>{m.value}</td>
                    <td>
                      {formatTimestamp(
                        (m as typeof m & { firstFetchedAt?: string })
                          .firstFetchedAt,
                        now,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {page &&
        ((page.kind === 'runs' && !page.runs?.length) ||
          (page.kind === 'observations' && !obs.length) ||
          (page.kind === 'forecast' && !page.forecast?.points.length)) && (
          <p className="empty-message">
            {t(
              'No retained values for this range/source. This deployment does not fabricate past data.',
              'इस अवधि/स्रोत के रखे मान नहीं। पुराने डेटा का निर्माण नहीं किया जाता।',
            )}
          </p>
        )}
      {(kind === 'runs' ? catalogCursor : page?.nextCursor) && (
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() =>
            void load(
              kind,
              undefined,
              kind === 'runs' ? catalogCursor! : page!.nextCursor!,
            )
          }
        >
          {t('Next bounded page', 'अगला सीमित पृष्ठ')}
        </button>
      )}
      <p className="help-text">
        {t(
          'At most 50 runs or 500 observations per page; 90-day storage retention. Page statistics describe only included intervals. Local journal reports above remain separate from this server-side public evidence history.',
          'प्रति पृष्ठ 50 मॉडल या 500 मापन; संग्रह 90 दिन। आंकड़े केवल शामिल अंतराल के हैं। स्थानीय निर्णय रिपोर्ट इस सर्वर डेटा इतिहास से अलग हैं।',
        )}
      </p>
    </section>
  )
}
