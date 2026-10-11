import { lazy, Suspense, useEffect, useState } from 'react'
import type { Place, Language } from '../types.ts'
import { say } from '../lib/labels.ts'
import { timestampState } from '../lib/planner.ts'
const FireMap = lazy(() => import('./FireMap.tsx'))
export type WeatherPoint = {
  time: string
  temperature: number | null
  apparentTemperature: number | null
  humidity: number | null
  precipitation: number | null
  windSpeed: number | null
  windDirection: number | null
}
export type FirePoint = {
  id: string
  latitude: number
  longitude: number
  acquiredAt: string
  satellite: string
  instrument: string
  confidence: string
  fireRadiativePower: number
  unit: string
  product: string
}
type Weather = {
  fetchedAt: string
  source: string
  grid: { latitude: number; longitude: number }
  timezone: string
  fields: Record<string, { unit: string; statistic: string }>
  points: WeatherPoint[]
}
export type Fires = {
  fetchedAt: string
  source: string
  product: string
  bounds: { west: number; south: number; east: number; north: number }
  detections: FirePoint[]
  truncated: boolean
  discardedRows: number
  meaning: string
}
type Result = {
  schemaVersion: 1
  family: 'weather' | 'fires'
  status: string
  lastAttemptAt?: string | null
  lastSuccessAt?: string | null
  message?: string | null
  evidence: Weather | Fires | null
}
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v),
  time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v))
function valid(v: unknown, family: string): v is Result {
  const r = v as Result
  if (
    !r ||
    r.schemaVersion !== 1 ||
    r.family !== family ||
    ![
      'disabled',
      'pending',
      'unavailable',
      'available',
      'no_detections',
      'not_configured',
    ].includes(r.status)
  )
    return false
  if (r.evidence === null) return true
  if (
    !r.evidence ||
    !time(r.evidence.fetchedAt) ||
    typeof r.evidence.source !== 'string'
  )
    return false
  if (family === 'weather') {
    const w = r.evidence as Weather
    return (
      finite(w.grid?.latitude) &&
      finite(w.grid?.longitude) &&
      w.grid.latitude >= 6 &&
      w.grid.latitude <= 38 &&
      w.grid.longitude >= 68 &&
      w.grid.longitude <= 98 &&
      w.timezone === 'UTC' &&
      [
        ['temperature', '°C', 'instant'],
        ['apparentTemperature', '°C', 'instant'],
        ['humidity', '%', 'instant'],
        ['precipitation', 'mm', 'preceding_hour_total'],
        ['windSpeed', 'm/s', 'instant'],
        ['windDirection', '°', 'instant'],
      ].every(
        ([key, unit, statistic]) =>
          w.fields?.[key]?.unit === unit &&
          w.fields?.[key]?.statistic === statistic,
      ) &&
      Array.isArray(w.points) &&
      w.points.length <= 24 &&
      w.points.every(
        (p) =>
          time(p.time) &&
          [
            ['temperature', -90, 60],
            ['apparentTemperature', -120, 80],
            ['humidity', 0, 100],
            ['precipitation', 0, 1000],
            ['windSpeed', 0, 150],
            ['windDirection', 0, 360],
          ].every(([k, min, max]) => {
            const v = p[k as keyof WeatherPoint]
            return (
              v === null ||
              (finite(v) &&
                Number(v) >= Number(min) &&
                Number(v) <= Number(max))
            )
          }),
      )
    )
  }
  const f = r.evidence as Fires,
    b = f.bounds
  return (
    b &&
    [b.west, b.south, b.east, b.north].every(finite) &&
    b.east > b.west &&
    b.north > b.south &&
    b.east - b.west <= 2.01 &&
    b.north - b.south <= 2.01 &&
    b.west >= 68 &&
    b.east <= 98 &&
    b.south >= 6 &&
    b.north <= 38 &&
    typeof f.meaning === 'string' &&
    f.meaning.length <= 2000 &&
    typeof f.truncated === 'boolean' &&
    Number.isSafeInteger(f.discardedRows) &&
    f.discardedRows >= 0 &&
    ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'].includes(f.product) &&
    Array.isArray(f.detections) &&
    f.detections.length <= 500 &&
    f.detections.every(
      (p) =>
        typeof p.id === 'string' &&
        finite(p.latitude) &&
        finite(p.longitude) &&
        p.latitude >= b.south &&
        p.latitude <= b.north &&
        p.longitude >= b.west &&
        p.longitude <= b.east &&
        time(p.acquiredAt) &&
        Date.parse(p.acquiredAt) <= Date.now() + 300000 &&
        ['low', 'nominal', 'high'].includes(p.confidence) &&
        finite(p.fireRadiativePower) &&
        p.fireRadiativePower >= 0 &&
        p.unit === 'MW' &&
        p.instrument === 'VIIRS' &&
        p.product === f.product &&
        p.satellite === (f.product === 'VIIRS_NOAA20_NRT' ? 'N20' : 'N21'),
    )
  )
}
export default function ContextPanels({
  place,
  date,
  language,
  active,
  cap,
  configurationError,
  onRetryConfiguration,
}: {
  place: Place
  date: string
  language: Language
  active: boolean
  cap: { weather: boolean; fires: boolean } | null
  configurationError: string
  onRetryConfiguration: () => void
}) {
  const [weather, setWeather] = useState<Result | null>(null),
    [fires, setFires] = useState<Result | null>(null),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [map, setMap] = useState(false),
    [retry, setRetry] = useState(0),
    [now, setNow] = useState(Date.now)
  const latitude = Math.round(place.latitude * 10) / 10,
    longitude = Math.round(place.longitude * 10) / 10,
    API = import.meta.env.VITE_API_BASE_URL || '',
    t = (en: string, hi: string) => say(language, en, hi)
  useEffect(() => {
    if (!active || !cap) return
    const controller = new AbortController()
    let live = true
    async function load() {
      await Promise.all(
        ['weather', 'fires']
          .filter((f) => cap?.[f as keyof typeof cap])
          .map(async (family) => {
            try {
              const p = new URLSearchParams({
                  lat: String(latitude),
                  lon: String(longitude),
                  date,
                  mode: 'coordinates',
                }),
                r = await fetch(`${API}/api/context/${family}?${p}`, {
                  signal: AbortSignal.any([
                    controller.signal,
                    AbortSignal.timeout(20000),
                  ]),
                }),
                body = await r.json()
              if (!r.ok) throw new Error(body.error || 'Context unavailable.')
              if (!valid(body, family))
                throw new Error('Context response failed validation.')
              if (live) {
                ;(family === 'weather' ? setWeather : setFires)(body)
                setErrors((e) => ({ ...e, [family]: '' }))
              }
            } catch (e) {
              if (live && !controller.signal.aborted)
                setErrors((old) => ({
                  ...old,
                  [family]:
                    e instanceof Error ? e.message : 'Context unavailable.',
                }))
            }
          }),
      )
      if (live) setNow(Date.now())
    }
    void load()
    const poll = setInterval(() => void load(), 60000)
    return () => {
      live = false
      controller.abort()
      clearInterval(poll)
    }
  }, [API, active, cap, latitude, longitude, date, retry])
  if (!cap)
    return active ? (
      <section className="card">
        <h2>{t('Additional context', 'अतिरिक्त संदर्भ')}</h2>
        <p role={configurationError ? 'alert' : 'status'}>
          {configurationError ||
            t(
              'Checking available connections…',
              'उपलब्ध कनेक्शन जाँच रहे हैं…',
            )}
        </p>
        {configurationError && (
          <button
            type="button"
            className="button secondary"
            onClick={onRetryConfiguration}
          >
            {t('Retry connection', 'कनेक्शन फिर जाँचें')}
          </button>
        )}
      </section>
    ) : null
  if (!cap.weather && !cap.fires) return null
  const w = weather?.evidence as Weather | null,
    f = fires?.evidence as Fires | null
  const freshWeather =
    w && timestampState(w.fetchedAt, now, 3 * 3600000) === 'fresh'
  const cooler = (freshWeather ? w.points : [])
    .filter((p) => p.apparentTemperature !== null && Date.parse(p.time) > now)
    .sort(
      (a, b) =>
        a.apparentTemperature! - b.apparentTemperature! ||
        a.time.localeCompare(b.time),
    )[0]
  const drier = (freshWeather ? w.points : [])
    .filter((p) => p.precipitation !== null && Date.parse(p.time) > now)
    .sort(
      (a, b) =>
        a.precipitation! - b.precipitation! || a.time.localeCompare(b.time),
    )[0]
  return (
    <div className="r3-context">
      <button
        className="text-button"
        type="button"
        onClick={() => setRetry((n) => n + 1)}
      >
        {t('Refresh weather / fire context', 'मौसम / आग संदर्भ ताज़ा करें')}
      </button>
      {cap.weather && (
        <section className="card" id="weather-context" tabIndex={-1}>
          <h2>{t('Weather context', 'मौसम संदर्भ')}</h2>
          <p>
            {errors.weather
              ? t('Refresh failed', 'रिफ्रेश असफल')
              : weather?.status || 'pending'}
            {weather?.message && <> · {weather.message}</>}
          </p>
          {errors.weather && (
            <p role="alert">
              {errors.weather}
              {w && (
                <>
                  {' '}
                  {t(
                    'Showing the last retrieved weather; its original retrieval time is retained.',
                    'पिछला प्राप्त मौसम दिखाया जा रहा है; उसका मूल प्राप्ति समय बरकरार है।',
                  )}
                </>
              )}
            </p>
          )}
          {w && (
            <>
              <p>
                {w.source} · retrieved {w.fetchedAt} ·{' '}
                {timestampState(w.fetchedAt, now, 3 * 3600000)} · last attempt{' '}
                {weather?.lastAttemptAt || 'unavailable'} · last successful
                retrieval {weather?.lastSuccessAt || 'unavailable'}
              </p>
              <p>
                {t('Returned model grid', 'प्राप्त मॉडल ग्रिड')}:{' '}
                {w.grid.latitude}, {w.grid.longitude} ·{' '}
                {t(
                  'Source times are UTC; the table shows IST.',
                  'स्रोत समय UTC है; तालिका में IST दिखाया गया है।',
                )}
              </p>
              {cooler && (
                <p>
                  {t(
                    'Lowest available future apparent-temperature instant',
                    'उपलब्ध भविष्य में न्यूनतम अनुभूत तापमान',
                  )}
                  :{' '}
                  {new Date(cooler.time).toLocaleTimeString(
                    language === 'hi' ? 'hi-IN' : 'en-IN',
                    {
                      timeZone: 'Asia/Kolkata',
                      hour: '2-digit',
                      minute: '2-digit',
                    },
                  )}{' '}
                  IST · {cooler.apparentTemperature} °C.{' '}
                  {t(
                    'Ranked by apparent temperature, then earliest time. Weather context is separate from the PM2.5 planning rule and is not an official heatwave declaration.',
                    'अनुभूत तापमान, फिर पहले समय के अनुसार। मौसम PM2.5 नियम से अलग है; आधिकारिक लू घोषणा नहीं।',
                  )}
                </p>
              )}
              {drier && (
                <p>
                  {t(
                    'Lowest available future preceding-hour rainfall forecast',
                    'आगामी समय में पिछले घंटे की न्यूनतम वर्षा का पूर्वानुमान',
                  )}
                  :{' '}
                  {new Date(drier.time).toLocaleTimeString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  IST · {drier.precipitation} mm.{' '}
                  {t(
                    'Ranked by forecast rainfall total, then earliest time; this does not guarantee dry conditions.',
                    'पूर्वानुमानित कुल वर्षा, फिर पहले समय के अनुसार; सूखे मौसम की गारंटी नहीं।',
                  )}
                </p>
              )}
              {!freshWeather && (
                <p>
                  {t(
                    'Retained weather is old or unverified. Timing suggestions are withheld.',
                    'सहेजा मौसम पुराना या असत्यापित है। समय सुझाव उपलब्ध नहीं हैं।',
                  )}
                </p>
              )}
              {!w.points.length && (
                <p>
                  {t(
                    'No usable weather times returned for this date.',
                    'इस दिन के लिए उपयोगी मौसम समय उपलब्ध नहीं है।',
                  )}
                </p>
              )}
              <div className="table-scroll">
                <table>
                  <caption>
                    {t(
                      'Hourly weather forecast · no interpolation over missing values',
                      'प्रति घंटे मौसम पूर्वानुमान · गायब डेटा नहीं भरा जाता',
                    )}
                  </caption>
                  <thead>
                    <tr>
                      <th>Time · IST</th>
                      <th>Temperature °C</th>
                      <th>Apparent °C</th>
                      <th>Humidity %</th>
                      <th>Preceding-hour rain mm</th>
                      <th>Wind m/s</th>
                      <th>Direction °</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.points.map((p) => (
                      <tr key={p.time}>
                        <th>
                          {new Date(p.time).toLocaleTimeString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </th>
                        <td>{p.temperature ?? '—'}</td>
                        <td>{p.apparentTemperature ?? '—'}</td>
                        <td>{p.humidity ?? '—'}</td>
                        <td>{p.precipitation ?? '—'}</td>
                        <td>{p.windSpeed ?? '—'}</td>
                        <td>{p.windDirection ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <a
            href="https://open-meteo.com/en/docs"
            target="_blank"
            rel="noreferrer"
          >
            Open-Meteo weather attribution and fields
          </a>
        </section>
      )}
      {cap.fires && (
        <section className="card" id="fire-context" tabIndex={-1}>
          <h2>
            {t('Recent satellite fire detections', 'हाल के उपग्रह आग संकेत')}
          </h2>
          <p>
            {errors.fires
              ? t('Refresh failed', 'रिफ्रेश असफल')
              : fires?.status || 'pending'}
            {fires?.message && <> · {fires.message}</>}
          </p>
          {errors.fires && (
            <p role="alert">
              {errors.fires}
              {f && (
                <>
                  {' '}
                  {t(
                    'Showing the last retrieved detections; their original retrieval time is retained.',
                    'पिछले प्राप्त संकेत दिखाए जा रहे हैं; उनका मूल प्राप्ति समय बरकरार है।',
                  )}
                </>
              )}
            </p>
          )}
          {f && (
            <>
              <p>
                {f.product} · retrieved {f.fetchedAt} ·{' '}
                {timestampState(f.fetchedAt, now, 3 * 3600000)} · acquisition
                window: last 48 hours · last attempt{' '}
                {fires?.lastAttemptAt || 'unavailable'}
              </p>
              <p>{f.meaning}</p>
              <p>
                Wind is separate weather context; it does not establish
                transport, stubble identity or pollution attribution.
              </p>
              {f.truncated && (
                <p role="status">
                  Showing the newest 500 detections; additional points were
                  omitted.
                </p>
              )}
              {f.discardedRows > 0 && (
                <p>
                  {f.discardedRows} rows were discarded because metadata,
                  coverage or acquisition time could not be validated.
                </p>
              )}
              {!map ? (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setMap(true)}
                >
                  Show detection positions
                </button>
              ) : (
                <Suspense fallback={<p>Loading map…</p>}>
                  <FireMap evidence={f} />
                </Suspense>
              )}
              <div className="table-scroll">
                <table>
                  <caption>Satellite acquisition details</caption>
                  <thead>
                    <tr>
                      <th>UTC acquisition</th>
                      <th>Latitude</th>
                      <th>Longitude</th>
                      <th>Satellite</th>
                      <th>Confidence</th>
                      <th>Radiative power MW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.detections.map((p) => (
                      <tr key={p.id}>
                        <th>{p.acquiredAt}</th>
                        <td>{p.latitude}</td>
                        <td>{p.longitude}</td>
                        <td>{p.satellite}</td>
                        <td>{p.confidence}</td>
                        <td>{p.fireRadiativePower}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!f.detections.length && (
                <p>
                  No detections returned for this region and period. This does
                  not establish absence of fire.
                </p>
              )}
            </>
          )}
          <a
            href="https://firms.modaps.eosdis.nasa.gov/"
            target="_blank"
            rel="noreferrer"
          >
            NASA FIRMS attribution
          </a>
        </section>
      )}
    </div>
  )
}
