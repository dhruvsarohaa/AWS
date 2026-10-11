import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import type { DashboardData, Language, Monitor } from '../types.ts'
import {
  concentration,
  formatTimestamp,
  timestampState,
} from '../lib/planner.ts'
import { providerPresentation } from '../lib/evidence-status.ts'
import { say } from '../lib/labels.ts'
import MapBoundary from './MapBoundary.tsx'
const StationMap = lazy(() => import('./StationMap.tsx'))
export default function StationExplorer({
  data,
  now,
  language,
  loading,
  active,
}: {
  data: DashboardData | null
  now: number
  language: Language
  loading: boolean
  active: boolean
}) {
  const [selected, setSelected] = useState<{
      monitor: Monitor
      data: DashboardData | null
    } | null>(null),
    t = (en: string, hi: string) => say(language, en, hi)
  const closeDrawer = useCallback(() => setSelected(null), [])
  const selectMonitor = useCallback(
    (m: Monitor) =>
      setSelected({ monitor: structuredClone(m), data: structuredClone(data) }),
    [data],
  )
  const [mapRequested, setMapRequested] = useState(false)
  const monitors = data?.nearbyMonitors || data?.monitors || []
  return (
    <section
      className="card station-explorer"
      aria-labelledby="station-list-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="station-list-title" tabIndex={-1}>
            {t('Nearby stations', 'नज़दीकी स्टेशन')}
          </h2>
          <p className="section-meta">
            {t('Independent observations', 'अलग अवलोकन')}
          </p>
          {monitors.length > 0 &&
            !monitors.some(
              (m) =>
                Number.isFinite(m.latitude) && Number.isFinite(m.longitude),
            ) && (
              <p className="help-text">
                {t(
                  'Station coordinates are unavailable; use the station list.',
                  'स्टेशन निर्देशांक नहीं; सूची का उपयोग करें।',
                )}
              </p>
            )}
        </div>
        <span className="badge neutral">
          {monitors.length} {t('returned', 'मिले')}
        </span>
      </div>
      <p className="help-text">
        {t(
          'The bounded search prioritizes stations likely to report recently, then verifies returned measurements. It is not a complete network catalog or a guarantee of the nearest station. Instrument type and outdoor siting are separate from freshness; a station cannot verify conditions at your building.',
          'सीमित खोज पहले हाल में रिपोर्ट करने वाले स्टेशन देखती है, फिर मिले मापन जांचती है। यह पूरे नेटवर्क या सबसे नज़दीकी स्टेशन की गारंटी नहीं। उपकरण और बाहरी स्थापना का सत्यापन ताज़गी से अलग है; स्टेशन आपके भवन की स्थिति नहीं बताता।',
        )}
      </p>
      {import.meta.env.VITE_STATION_MAP_ENABLED !== 'false' && (
        <details className="map-controls">
          <summary>
            {t('Optional station map', 'वैकल्पिक स्टेशन मानचित्र')}
          </summary>
          <a href="/third-party-notices.txt" target="_blank" rel="noreferrer">
            {t(
              'Map attribution & software license',
              'नक्शा श्रेय और सॉफ्टवेयर लाइसेंस',
            )}{' '}
            ↗
          </a>
          <p className="help-text">
            {t(
              'Loading the basemap contacts OpenStreetMap and sends your browser IP and the rounded viewing area. Exact detected GPS is not used in map requests. Tiles are not saved for offline use. You can use the list without loading a map.',
              'नक्शा लोड करने पर OpenStreetMap को ब्राउज़र IP और गोल देखने का क्षेत्र भेजा जाता है। सटीक GPS उपयोग नहीं होता। ऑफलाइन चित्र नहीं रखे जाते। नक्शे बिना सूची उपयोग करें।',
            )}
          </p>
          <button
            className="button secondary"
            type="button"
            disabled={!data}
            onClick={() => setMapRequested((v) => !v)}
          >
            {mapRequested
              ? t('Unload map', 'नक्शा बंद करें')
              : t('Load map', 'नक्शा लोड करें')}
          </button>
          {mapRequested && active && data && (
            <MapBoundary
              message={t(
                'Map controls could not load. The station list and planning remain available. Retry the page after saving any open drafts.',
                'नक्शा नहीं लोड हुआ। स्टेशन सूची और योजना उपलब्ध हैं। खुले ड्राफ्ट सहेजने के बाद पृष्ठ फिर खोलें।',
              )}
            >
              <Suspense
                fallback={
                  <p role="status">
                    {t('Loading map controls…', 'नक्शा लोड हो रहा…')}
                  </p>
                }
              >
                <StationMap
                  key={`${data.location.latitude}:${data.location.longitude}`}
                  data={data}
                  monitors={monitors}
                  now={now}
                  language={language}
                  onSelect={selectMonitor}
                />
              </Suspense>
            </MapBoundary>
          )}
        </details>
      )}
      {monitors.length ? (
        <ul className="station-list">
          {monitors.map((m) => (
            <li key={`${m.source}:${m.id || m.station}:${m.sensorId || ''}`}>
              <button
                type="button"
                className="station-select"
                aria-label={`${t('View details for', 'विवरण देखें')} ${m.station}. ${m.source}. PM2.5 ${concentration(m.value)} µg/m³. ${formatTimestamp(m.observedAt, now)}. ${timestampState(m.observedAt, now) === 'fresh' ? t('Recent reading', 'ताज़ा रीडिंग') : t('Old or unverified time', 'पुराना या अप्रमाणित समय')}`}
                onClick={() => selectMonitor(m)}
              >
                <span>
                  <strong>{m.station}</strong>
                  <small>
                    {m.source} ·{' '}
                    {m.distanceKm != null
                      ? `${m.distanceKm.toFixed(1)} km`
                      : t('Distance unavailable', 'दूरी उपलब्ध नहीं')}
                  </small>
                  <small>{formatTimestamp(m.observedAt, now)}</small>
                </span>
                <span>
                  <strong>
                    {concentration(m.value)} <small>µg/m³ PM2.5</small>
                  </strong>
                  <span
                    className={`badge ${timestampState(m.observedAt, now) === 'fresh' ? 'neutral' : 'warning'}`}
                  >
                    {timestampState(m.observedAt, now) === 'fresh'
                      ? t('Recent reading', 'ताज़ा रीडिंग')
                      : t('Old / unverified time', 'पुराना / अप्रमाणित समय')}
                  </span>
                  <small>
                    {t('View station details →', 'स्टेशन विवरण देखें →')}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-message">
          {loading
            ? t(
                'Checking available observations…',
                'उपलब्ध अवलोकन देख रहे हैं…',
              )
            : t(
                'No usable station reading was returned. The regional forecast remains separate; check source status for the reason.',
                'उपयोगी स्टेशन रीडिंग नहीं मिली। क्षेत्रीय पूर्वानुमान अलग है; कारण के लिए स्रोत स्थिति देखें।',
              )}
        </p>
      )}
      <details>
        <summary>
          {t(
            'Why a feed can be missing or disagree',
            'स्रोत क्यों नहीं मिलता या अलग बताता है',
          )}
        </summary>
        <p>
          {t(
            'Coverage, sensor identity, time, units and processing differ between providers. We do not average unlike readings or infer which source is correct. A successful retrieval can still contain an older measurement.',
            'कवरेज, सेंसर पहचान, समय, इकाई और प्रसंस्करण स्रोतों में अलग होते हैं। अलग रीडिंग का औसत या सही स्रोत का अनुमान नहीं किया जाता। सफल अनुरोध में भी पुराना मापन हो सकता है।',
          )}
        </p>
        {data?.comparison && <p lang="en">{data.comparison.message}</p>}
      </details>
      {selected && (
        <StationDrawer
          monitor={selected.monitor}
          data={selected.data}
          now={now}
          language={language}
          onClose={closeDrawer}
        />
      )}
    </section>
  )
}
function StationDrawer({
  monitor: m,
  data,
  now,
  language,
  onClose,
}: {
  monitor: Monitor
  data: DashboardData | null
  now: number
  language: Language
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    title = useId(),
    t = (en: string, hi: string) => say(language, en, hi)
  const source = data?.sources[m.source === 'OpenAQ' ? 'openaq' : 'cpcb'],
    presentation = source ? providerPresentation(source, m, now) : null
  useEffect(() => {
    const node = dialog.current,
      trigger = document.activeElement as HTMLElement | null,
      previous = document.body.style.overflow
    node?.showModal()
    document.body.style.overflow = 'hidden'
    node?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      node?.close()
      document.body.style.overflow = previous
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])
  useEffect(() => {
    window.addEventListener('popstate', onClose)
    window.addEventListener('hashchange', onClose)
    return () => {
      window.removeEventListener('popstate', onClose)
      window.removeEventListener('hashchange', onClose)
    }
  }, [onClose])
  return (
    <dialog
      className="station-drawer plan-dialog"
      ref={dialog}
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="dialog-heading">
        <div>
          <h2 id={title}>{m.station}</h2>
          <p className="section-meta">
            {t('Station reading at selection', 'चयन के समय स्टेशन रीडिंग')}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label={t('Close station details', 'स्टेशन विवरण बंद करें')}
        >
          ×
        </button>
      </div>
      <p className="station-value">
        {concentration(m.value)} <small>{m.unit} PM2.5</small>
      </p>
      <p className="coverage-warning">
        {timestampState(m.observedAt, now) === 'fresh'
          ? t(
              'Recent observation; not a reading at your exact location.',
              'ताज़ा अवलोकन; आपके सटीक स्थान का मापन नहीं।',
            )
          : t(
              'Old or unverified observation time. Do not treat this as current.',
              'पुराना या अप्रमाणित समय। इसे वर्तमान न मानें।',
            )}
      </p>
      <dl>
        <div>
          <dt>{t('Observed', 'अवलोकन समय')}</dt>
          <dd>{formatTimestamp(m.observedAt, now)}</dd>
        </div>
        <div>
          <dt>{t('Distance from selected position', 'चुने स्थान से दूरी')}</dt>
          <dd>
            {m.distanceKm != null
              ? `${m.distanceKm.toFixed(1)} km`
              : t('Unavailable', 'उपलब्ध नहीं')}
          </dd>
        </div>
        <div>
          <dt>{t('Statistic / averaging period', 'आंकड़ा / औसत अवधि')}</dt>
          <dd>
            {m.statistic || t('Unknown', 'अज्ञात')} ·{' '}
            {m.period
              ? `${formatTimestamp(m.period.start, now)} → ${formatTimestamp(m.period.end, now)}`
              : t('Period not supplied', 'अवधि नहीं दी गई')}
          </dd>
        </div>
        <div>
          <dt>
            {t('Provider instrument classification', 'स्रोत का उपकरण वर्ग')}
          </dt>
          <dd>
            {m.referenceMonitor === true
              ? t(
                  'Provider identifies a reference monitor',
                  'स्रोत ने संदर्भ मॉनिटर बताया',
                )
              : m.referenceMonitor === false
                ? t('Provider identifies a sensor', 'स्रोत ने सेंसर बताया')
                : t('Not supplied', 'नहीं दिया गया')}{' '}
            ·{' '}
            {m.instruments?.join(', ') ||
              t('Instrument not supplied', 'उपकरण नहीं दिया गया')}
          </dd>
        </div>
        <div>
          <dt>{t('Outdoor siting', 'बाहरी स्थापना')}</dt>
          <dd>
            {t(
              'Not independently verified. Explicitly indoor-labelled locations are excluded from new searches; this does not certify every returned location as outdoors.',
              'स्वतंत्र सत्यापन नहीं। नए खोज में स्पष्ट अंदर बताए स्थान हटाए जाते हैं; इससे हर मिले स्थान की बाहरी स्थापना प्रमाणित नहीं होती।',
            )}
          </dd>
        </div>
        <div>
          <dt>{t('Owner / upstream provider', 'स्वामी / मूल स्रोत')}</dt>
          <dd>
            {m.owner || t('Unknown', 'अज्ञात')} ·{' '}
            {m.upstreamProvider || m.source}
          </dd>
        </div>
        <div>
          <dt>{t('Quality', 'गुणवत्ता')}</dt>
          <dd>
            {m.qualityStatus === 'checked'
              ? m.qualityFlags?.length
                ? t(
                    'Flags present; review before use',
                    'चेतावनियां हैं; उपयोग से पहले समीक्षा करें',
                  )
                : t(
                    'Provider flag check completed; this is not independent calibration',
                    'स्रोत चेतावनी जांच पूरी; यह स्वतंत्र अंशांकन नहीं',
                  )
              : t(
                  'Not supplied or independently verified',
                  'नहीं दिया गया या स्वतंत्र सत्यापन नहीं',
                )}
          </dd>
        </div>
        <div>
          <dt>{t('Retrieval', 'डेटा प्राप्ति')}</dt>
          <dd>
            {presentation?.retrievalLabel || t('Unknown', 'अज्ञात')}
            {presentation?.failed ? ` · ${presentation.message}` : ''}
          </dd>
        </div>
        <div>
          <dt>{t('Last attempt / success', 'अंतिम प्रयास / सफलता')}</dt>
          <dd>
            {formatTimestamp(source?.lastAttemptAt, now)} /{' '}
            {formatTimestamp(source?.lastSuccessAt, now)}
          </dd>
        </div>
      </dl>
      <p className="help-text">
        {t(
          'This drawer freezes the selected reading. Close and select again to inspect refreshed data.',
          'यह विवरण चुनी रीडिंग को स्थिर रखता है। नया डेटा देखने के लिए बंद करके फिर चुनें।',
        )}
      </p>
      <a href={m.url} target="_blank" rel="noreferrer">
        {m.source} ↗
      </a>
    </dialog>
  )
}
