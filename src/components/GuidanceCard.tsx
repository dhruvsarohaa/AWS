import type { ActivityView } from '../lib/activity-view.ts'
import type { Language } from '../types.ts'
import { say } from '../lib/labels.ts'
import { planningGuidance } from '../lib/guidance.ts'
export default function GuidanceCard({
  views,
  language,
  forecastFresh,
}: {
  views: ActivityView[]
  language: Language
  forecastFresh: boolean
}) {
  const t = (en: string, hi: string) => say(language, en, hi)
  const guidance = planningGuidance(views, language, forecastFresh)
  return (
    <section
      className="card guidance-card"
      aria-labelledby="guidance-title"
      lang={language}
    >
      <h2 id="guidance-title">
        {t('A review prompt, your decision', 'समीक्षा का संकेत, आपका निर्णय')}
      </h2>
      <ul>
        <li>{guidance.prompt}</li>
        {guidance.options && <li>{guidance.options}</li>}
        <li>
          {t(
            'An outdoor forecast cannot verify indoor air. Confirm that an indoor alternative is suitable each time.',
            'बाहरी पूर्वानुमान अंदर की हवा नहीं बताता। हर बार अंदर के विकल्प की उपयुक्तता की पुष्टि करें।',
          )}
        </li>
        <li>
          {t(
            'For school activities, follow the school’s approval process and check current local education and air-quality directions.',
            'स्कूल की गतिविधियों के लिए स्कूल की अनुमोदन प्रक्रिया और वर्तमान स्थानीय शिक्षा एवं वायु गुणवत्ता निर्देश देखें।',
          )}
        </li>
      </ul>
      <p className="help-text">
        {t(
          'These deterministic explanations describe the app’s review rule. They are not medical advice, an official AQI category, or a school closure order.',
          'ये नियम-आधारित विवरण ऐप की समीक्षा सीमा समझाते हैं। ये चिकित्सा सलाह, आधिकारिक AQI श्रेणी या स्कूल बंद करने का आदेश नहीं हैं।',
        )}
      </p>
      <a
        href="https://open-meteo.com/en/docs/air-quality-api"
        target="_blank"
        rel="noreferrer"
      >
        {t(
          'Forecast method and limitations ↗',
          'पूर्वानुमान की विधि और सीमाएं ↗',
        )}
      </a>
    </section>
  )
}
