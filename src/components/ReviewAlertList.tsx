import type { ReviewAlert } from '../lib/review-alerts.ts'
import type { Language } from '../types.ts'
import { reviewReasonLabel, say } from '../lib/labels.ts'
export default function ReviewAlertList({
  alerts,
  language,
  disabled,
  onDismiss,
  onReview,
}: {
  alerts: ReviewAlert[]
  language: Language
  disabled: boolean
  onDismiss: (id: string) => void
  onReview: (id: string) => void
}) {
  const t = (en: string, hi: string) => say(language, en, hi)
  const titles = {
    review: t('Above your review rule', 'आपकी सीमा से ऊपर'),
    recheck: t('Recorded evidence changed', 'दर्ज डेटा बदल गया'),
    reopened: t('Decision reopened', 'निर्णय फिर खोला गया'),
    incomplete: t('Forecast has gaps', 'पूर्वानुमान अधूरा है'),
    unavailable: t('No fresh forecast', 'ताज़ा पूर्वानुमान नहीं'),
  }
  return (
    <section className="card review-inbox" aria-labelledby="alerts-title">
      <div className="section-heading">
        <h2 id="alerts-title" tabIndex={-1}>
          {t('Review inbox', 'समीक्षा संदेश')}
        </h2>
        <span className="badge neutral">{alerts.length}</span>
      </div>
      <p className="help-text">
        {t(
          'In-app prompts for this date and location. Dismissing a prompt does not resolve its activity or send a notification.',
          'इस दिन और स्थान के ऐप संदेश। संदेश हटाने से गतिविधि का निर्णय पूरा नहीं होता और कोई सूचना नहीं भेजी जाती।',
        )}
      </p>
      {alerts.length ? (
        <ul className="alert-list">
          {alerts.map((a) => (
            <li key={a.id}>
              <div>
                <strong>{a.activity}</strong>
                <p>{titles[a.status as keyof typeof titles]}</p>
                {a.reasons.length > 0 && (
                  <details>
                    <summary>{t('What changed', 'क्या बदला')}</summary>
                    <ul>
                      {a.reasons.map((r) => (
                        <li key={r}>{reviewReasonLabel(r, language)}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onReview(a.activityId)}
                >
                  {t('Review activity', 'गतिविधि देखें')}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  className="text-button"
                  aria-label={`${t('Dismiss prompt for', 'संदेश हटाएं:')} ${a.activity}`}
                  onClick={() => {
                    document.getElementById('alerts-title')?.focus()
                    onDismiss(a.id)
                  }}
                >
                  {t('Dismiss', 'हटाएं')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          {t(
            'No undismissed review prompts for this date. Check the timeline and evidence before acting.',
            'इस दिन के कोई बाकी संदेश नहीं हैं। निर्णय से पहले समयरेखा और डेटा देखें।',
          )}
        </p>
      )}
    </section>
  )
}
