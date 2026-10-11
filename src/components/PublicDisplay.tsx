import { useEffect, useState } from 'react'
import { dateInIndia, timestampState } from '../lib/planner.ts'
import { validPublicEvidence } from '../lib/public-contract.ts'
import type { PublicEvidence } from '../lib/public-contract.ts'
import './R3.css'
import '../glass.css'
const API = import.meta.env.VITE_API_BASE_URL || ''
export default function PublicDisplay() {
  const params = new URLSearchParams(location.search),
    area = params.get('area') || '',
    date = params.get('date') || ''
  const [data, setData] = useState<PublicEvidence | null>(null),
    [error, setError] = useState(''),
    [now, setNow] = useState(Date.now),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true,
      controller: AbortController | null = null
    async function load() {
      controller?.abort()
      controller = new AbortController()
      const current = controller
      setLoading(true)
      try {
        const q = new URLSearchParams({ area, date: date || dateInIndia() })
        const response = await fetch(`${API}/api/public/evidence?${q}`, {
          signal: AbortSignal.any([current.signal, AbortSignal.timeout(15000)]),
        })
        const value = await response.json()
        if (!response.ok)
          throw new Error(value.error || 'Public evidence unavailable.')
        if (!validPublicEvidence(value))
          throw new Error('Unsupported public evidence response.')
        if (active && !current.signal.aborted) {
          setData(value)
          setError('')
        }
      } catch (e) {
        if (active && !current.signal.aborted)
          setError(
            e instanceof Error ? e.message : 'Public evidence unavailable.',
          )
      } finally {
        if (active && !current.signal.aborted) {
          setLoading(false)
          setNow(Date.now())
        }
      }
    }
    void load()
    const poll = setInterval(() => {
      setNow(Date.now())
      void load()
    }, 60000)
    return () => {
      active = false
      controller?.abort()
      clearInterval(poll)
    }
  }, [area, date, retry])
  return (
    <main className="public-display">
      <h1>Airday · public air evidence</h1>
      <p>
        Coarse area {area} · {date || dateInIndia()} IST
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={loading}
        onClick={() => setRetry((n) => n + 1)}
      >
        Refresh public evidence
      </button>
      {error && (
        <p role="alert">
          {error} {data ? 'Showing the last retrieved snapshot below.' : ''}
        </p>
      )}
      {!navigator.onLine && (
        <p role="status">Offline: retained evidence is not current.</p>
      )}
      {data && (
        <>
          <p>
            Public snapshot generated {data.generatedAt}. Forecast retrieved{' '}
            {data.forecast?.fetchedAt || 'unavailable'} ·{' '}
            {timestampState(data.forecast?.fetchedAt, now, 6 * 3600000)}.
            Sources: forecast {data.sources.forecast.status}, OpenAQ{' '}
            {data.sources.openaq.status}, CPCB {data.sources.cpcb.status}.
          </p>
          <div className="table-scroll">
            <table>
              <caption>Regional forecast · concentrations in µg/m³</caption>
              <thead>
                <tr>
                  <th>Time · IST</th>
                  <th>PM2.5</th>
                  <th>PM10</th>
                </tr>
              </thead>
              <tbody>
                {data.forecast?.points.map((p) => (
                  <tr key={p.time}>
                    <th>
                      {new Date(p.time).toLocaleTimeString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </th>
                    <td>{p.pm25 ?? 'unavailable'}</td>
                    <td>{p.pm10 ?? 'unavailable'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Independent station observations</h2>
          {data.observations.map((m, i) => (
            <article key={`${m.source}-${m.station}-${i}`}>
              <h3>
                {m.station} · {m.source}
              </h3>
              <p>
                {m.value} {m.unit} PM2.5 · measured{' '}
                {m.observedAt || 'unverified'} ·{' '}
                {timestampState(m.observedAt, now)}
              </p>
              <p>
                {m.statistic || 'statistic unavailable'} · period{' '}
                {m.period ? `${m.period.start}–${m.period.end}` : 'unavailable'}{' '}
                · quality flags {m.qualityFlags.join(', ') || 'none reported'}
              </p>
            </article>
          ))}
          {!data.observations.length && (
            <p>No usable independent observations returned.</p>
          )}
          <p>{data.guidance}</p>
          <p>
            Sources:{' '}
            <a
              href="https://open-meteo.com/en/docs/air-quality-api"
              rel="noreferrer"
              target="_blank"
            >
              Open-Meteo / CAMS
            </a>{' '}
            ·{' '}
            <a href="https://openaq.org/" rel="noreferrer" target="_blank">
              OpenAQ
            </a>{' '}
            ·{' '}
            <a href="https://www.data.gov.in/" rel="noreferrer" target="_blank">
              data.gov.in
            </a>
          </p>
        </>
      )}
    </main>
  )
}
