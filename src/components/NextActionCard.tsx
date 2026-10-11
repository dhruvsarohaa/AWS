import type { ActivityView } from '../lib/activity-view.ts'
import type { DashboardData, Language, Place } from '../types.ts'
import {
  FORECAST_MAX_AGE,
  formatTimestamp,
  timestampState,
} from '../lib/planner.ts'
import { actionLabel, say } from '../lib/labels.ts'
export default function NextActionCard({
  views,
  place,
  date,
  data,
  now,
  language,
  onReview,
  onFind,
  onPlace,
  onEvidence,
}: {
  views: ActivityView[]
  place: Place
  date: string
  data: DashboardData | null
  now: number
  language: Language
  onReview: (id: string) => void
  onFind: () => void
  onPlace: () => void
  onEvidence: () => void
}) {
  const t = (en: string, hi: string) => say(language, en, hi)
  const active = views.filter((v) => v.status !== 'preview' && !v.passed)
  const unresolved = active.filter((v) => v.unresolved),
    next = unresolved[0] || active[0]
  const fresh =
    data?.forecast &&
    timestampState(data.forecast.fetchedAt, now, FORECAST_MAX_AGE) === 'fresh'
  const observed = data?.monitors.some(
    (m) => timestampState(m.observedAt, now) === 'fresh',
  )
  return (
    <section className="next-action-card" aria-labelledby="next-title">
      <div>
        <h2 id="next-title">
          {!place.confirmed
            ? t('Start with your place', 'अपने स्थान से शुरू करें')
            : next
              ? next.activity
              : t(
                  'Plan one outdoor activity',
                  'एक बाहरी गतिविधि की योजना बनाएं',
                )}
        </h2>
        <p className="next-date">
          {t('Next activity', 'अगली गतिविधि')} · {date} IST
        </p>
        {next && (
          <p className="next-window">
            {next.current?.chosenWindow?.start || next.start}–
            {next.current?.chosenWindow?.end || next.end} IST ·{' '}
            {next.current && !next.unresolved
              ? actionLabel(next.current.choice, language)
              : t('Decision needs review', 'निर्णय की समीक्षा चाहिए')}
          </p>
        )}
        <p>
          {!place.confirmed
            ? t(
                'Confirm a location to make these review prompts yours.',
                'अपने समीक्षा संकेतों के लिए स्थान की पुष्टि करें।',
              )
            : next?.status === 'recheck'
              ? t(
                  'The evidence changed. Review the recorded choice before acting.',
                  'डेटा बदल गया। निर्णय लागू करने से पहले दर्ज विकल्प की समीक्षा करें।',
                )
              : next
                ? t(
                    'Compare available evidence and choose the response that fits your activity.',
                    'उपलब्ध डेटा देखें और गतिविधि के लिए उचित निर्णय चुनें।',
                  )
                : t(
                    'Choose a duration and allowed hours. No account or full timetable needed.',
                    'अवधि और उपलब्ध समय चुनें। खाते या पूरी समय-सारणी की आवश्यकता नहीं।',
                  )}
        </p>
        <div className="context-chips">
          <span>
            {unresolved.length} {t('awaiting review', 'समीक्षा बाकी')}
          </span>
          <span>
            {fresh
              ? observed
                ? t(
                    'Forecast + recent observation',
                    'पूर्वानुमान + ताज़ा अवलोकन',
                  )
                : t(
                    'Forecast only / older observations',
                    'केवल पूर्वानुमान / पुराने अवलोकन',
                  )
              : data?.pending
                ? t('Evidence queued', 'डेटा कतार में')
                : t('No fresh forecast', 'ताज़ा पूर्वानुमान नहीं')}
          </span>
        </div>
        <p className="next-source-time">
          {t('Forecast retrieved', 'पूर्वानुमान प्राप्त')}:{' '}
          {formatTimestamp(data?.forecast?.fetchedAt, now)}
        </p>
        {data?.sources.forecast?.status === 'unavailable' && (
          <p className="next-retrieval-warning">
            {t(
              'The latest forecast refresh failed. Earlier values retain their original timestamp; open Evidence for source status.',
              'अंतिम पूर्वानुमान रीफ़्रेश विफल हुआ। पहले के मान अपने मूल समय के साथ हैं; स्रोत स्थिति के लिए डेटा खोलें।',
            )}
          </p>
        )}
      </div>
      <div className="next-action-buttons">
        <button
          type="button"
          className="button light"
          onClick={
            !place.confirmed ? onPlace : next ? () => onReview(next.id) : onFind
          }
        >
          {!place.confirmed
            ? t('Choose my place', 'अपना स्थान चुनें')
            : next
              ? next.current && !next.unresolved
                ? t('View recorded choice', 'दर्ज निर्णय देखें')
                : t('Review activity', 'गतिविधि देखें')
              : t('Find a time', 'समय खोजें')}
        </button>
        <button
          type="button"
          className="button outline-light"
          onClick={onEvidence}
        >
          {t('View evidence', 'डेटा देखें')}
        </button>
      </div>
    </section>
  )
}
