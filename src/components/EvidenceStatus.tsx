import type { DashboardData, Language } from '../types.ts'
import {
  FORECAST_MAX_AGE,
  formatTimestamp,
  timestampState,
} from '../lib/planner.ts'
import { say } from '../lib/labels.ts'
export default function EvidenceStatus({
  data,
  now,
  language,
  loading,
  error,
}: {
  data: DashboardData | null
  now: number
  language: Language
  loading: boolean
  error: string
}) {
  const t = (en: string, hi: string) => say(language, en, hi)
  const retrieval = {
    live: t('Feed retrieved', 'डेटा प्राप्त'),
    stale: t('Previous retrieval is old', 'पुराना प्राप्त डेटा'),
    not_configured: t('Provider not connected', 'स्रोत जुड़ा नहीं है'),
    unavailable: t('Retrieval unavailable', 'डेटा मिलना उपलब्ध नहीं'),
    no_data: t('No new nearby reading', 'नई नज़दीकी रीडिंग नहीं'),
    pending: t('Retrieval queued', 'डेटा अनुरोध कतार में'),
    unverified: t('Metadata needs review', 'जानकारी की समीक्षा चाहिए'),
  }
  const freshness = {
    fresh: t('recent time', 'हाल का समय'),
    stale: t('old', 'पुराना'),
    future: t('ahead of device clock', 'डिवाइस के समय से आगे'),
    unknown: t('time unverified', 'समय अप्रमाणित'),
  }
  const rows = data
    ? [
        {
          name: 'Open-Meteo / CAMS',
          status: data.sources.forecast,
          time: data.forecast?.fetchedAt,
          kind: 'forecast',
        },
        {
          name: 'OpenAQ',
          status: data.sources.openaq,
          time: data.monitors.find((m) => m.source === 'OpenAQ')?.observedAt,
          kind: 'monitor',
        },
        {
          name: 'CPCB / data.gov.in',
          status: data.sources.cpcb,
          time: data.monitors.find((m) => m.source === 'CPCB / data.gov.in')
            ?.observedAt,
          kind: 'monitor',
        },
      ]
    : []
  return (
    <section className="card source-health" aria-labelledby="health-title">
      <h2 id="health-title">{t('Evidence status', 'डेटा की स्थिति')}</h2>
      <p className="help-text">
        {t(
          'Provider retrieval and measurement freshness are separate. A successful fetch does not make an older station reading current.',
          'स्रोत से डेटा मिलना और रीडिंग का ताज़ा होना अलग हैं। सफल अनुरोध पुरानी रीडिंग को ताज़ा नहीं बनाता।',
        )}
      </p>
      {error && <p className="coverage-warning">{error}</p>}
      {!data && (
        <p>
          {loading
            ? t('Loading source status…', 'स्रोत की स्थिति लोड हो रही है…')
            : t(
                'Source status unavailable. Retry fetching evidence.',
                'स्रोत की स्थिति उपलब्ध नहीं है। डेटा फिर लाएं।',
              )}
        </p>
      )}
      <div className="health-grid">
        {rows.map((r) => (
          <article key={r.name}>
            <h3>{r.name}</h3>
            <p className="badge neutral">
              {r.status
                ? retrieval[r.status.status]
                : t('Status unknown', 'स्थिति अज्ञात')}
              {r.time
                ? ` · ${freshness[timestampState(r.time, now, r.kind === 'forecast' ? FORECAST_MAX_AGE : undefined)]}`
                : ''}
            </p>
            <p>
              {r.status?.message ||
                t(
                  'No provider detail available.',
                  'स्रोत की जानकारी उपलब्ध नहीं।',
                )}
            </p>
            <dl>
              <div>
                <dt>
                  {t(
                    r.kind === 'forecast' ? 'Forecast retrieved' : 'Observed',
                    r.kind === 'forecast' ? 'पूर्वानुमान प्राप्त' : 'अवलोकन',
                  )}
                </dt>
                <dd>{formatTimestamp(r.time, now)}</dd>
              </div>
              <div>
                <dt>{t('Last attempt', 'अंतिम प्रयास')}</dt>
                <dd>{formatTimestamp(r.status?.lastAttemptAt, now)}</dd>
              </div>
              <div>
                <dt>{t('Last successful retrieval', 'अंतिम सफल अनुरोध')}</dt>
                <dd>{formatTimestamp(r.status?.lastSuccessAt, now)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <p className="help-text">
        {t(
          'No fresh monitor? The regional forecast can still support planning, with its limits shown. Keys, quotas and raw error logs stay on the server.',
          'ताज़ा मॉनिटर नहीं? क्षेत्रीय पूर्वानुमान अपनी सीमाओं के साथ योजना बनाने में मदद कर सकता है। कुंजी, कोटा और त्रुटि लॉग सर्वर पर रहते हैं।',
        )}
      </p>
    </section>
  )
}
