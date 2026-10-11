import type { Language, OutdoorPlan } from '../types.ts'
import { say } from '../lib/labels.ts'
import { templates } from '../lib/templates.ts'
const names: Record<string, [string, string, string, string]> = {
  school: [
    'School day',
    'स्कूल का दिन',
    'Assembly, PE and recess with editable hours.',
    'बदलने योग्य समय के साथ प्रार्थना सभा, PE और अवकाश।',
  ],
  walk: [
    'Walk / exercise',
    'टहलना / व्यायाम',
    'A short activity within your available hours.',
    'अपने उपलब्ध समय में एक छोटी गतिविधि।',
  ],
  work: [
    'Outdoor work',
    'बाहरी काम',
    'A work block and practical time constraints.',
    'काम का समय और व्यावहारिक सीमाएं।',
  ],
  commute: [
    'Commute times',
    'यात्रा का समय',
    'Compare departure times, without route ranking.',
    'मार्गों का क्रम बनाए बिना निकलने के समय की तुलना।',
  ],
}
export default function PlanOverview({
  plan,
  language,
  disabled,
  sessionOnly,
  onEdit,
  onTemplate,
  onQuick,
}: {
  plan: OutdoorPlan
  language: Language
  disabled: boolean
  sessionOnly: boolean
  onEdit: () => void
  onTemplate: (plan: OutdoorPlan) => void
  onQuick: () => void
}) {
  const t = (en: string, hi: string) => say(language, en, hi),
    days =
      language === 'hi'
        ? ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि']
        : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return (
    <>
      <section className="card plan-overview">
        <div className="section-heading">
          <div>
            <h2>{plan.name}</h2>
            <p className="section-meta">
              {plan.configured
                ? sessionOnly
                  ? t('Session only', 'केवल इस सत्र में')
                  : t('Recurring plan', 'आपकी नियमित योजना')
                : t('Editable example', 'बदलने योग्य उदाहरण')}
            </p>
          </div>
          <button
            type="button"
            className="button primary"
            disabled={disabled}
            onClick={onEdit}
          >
            {plan.configured
              ? t('Edit recurring plan', 'नियमित योजना बदलें')
              : t('Review & confirm this plan', 'योजना देखें और पुष्टि करें')}
          </button>
        </div>
        <p className="help-text">
          {t('Review above', 'समीक्षा सीमा')}: {plan.threshold} µg/m³ PM2.5 ·{' '}
          {plan.ruleMode === 'example'
            ? t(
                'illustrative example, not an official limit',
                'उदाहरण, आधिकारिक सीमा नहीं',
              )
            : t('your configured rule', 'आपकी चुनी सीमा')}
        </p>
        <ul className="plan-summary-list">
          {plan.activities.map((a) => (
            <li key={a.id}>
              <div>
                <strong>{a.activity}</strong>
                <small>
                  {a.place} · {a.start}–{a.end} IST
                </small>
              </div>
              <div>
                <span>{a.days.map((d) => days[d]).join(', ')}</span>
                <small>
                  {a.flexible
                    ? `${t('Allowed', 'अनुमत')}: ${a.allowedStart}–${a.allowedEnd} IST`
                    : t('Fixed time', 'निश्चित समय')}
                </small>
              </div>
            </li>
          ))}
        </ul>
        <p className="help-text">
          {t(
            'Changing activities or the rule can require earlier dated decisions to be reviewed again. The earlier evidence remains in History.',
            'गतिविधि या सीमा बदलने पर पुराने दिन के निर्णय की फिर समीक्षा चाहिए हो सकती है। पुराना डेटा इतिहास में रहता है।',
          )}
        </p>
      </section>
      <section className="card template-gallery">
        <h2>{t('Start with a template', 'एक उदाहरण से शुरू करें')}</h2>
        <p>
          {t(
            'These are editable examples. Review the activities, recurrence, allowed hours and illustrative threshold before confirming.',
            'ये बदलने योग्य उदाहरण हैं। पुष्टि से पहले गतिविधि, नियमित दिन, उपलब्ध समय और उदाहरण सीमा देखें।',
          )}
        </p>
        <div className="template-grid">
          {Object.entries(templates).map(([key, value]) => (
            <article key={key}>
              <h3>{t(names[key][0], names[key][1])}</h3>
              <p>{t(names[key][2], names[key][3])}</p>
              <p className="help-text">
                {value.activities.length} {t('activities', 'गतिविधियां')} · 75
                µg/m³ {t('example rule', 'उदाहरण सीमा')}
              </p>
              <button
                type="button"
                className="button secondary"
                disabled={disabled}
                onClick={() => onTemplate(structuredClone(value))}
              >
                {t('Preview & edit', 'पूर्वावलोकन और संपादन')}
              </button>
            </article>
          ))}
        </div>
        <button type="button" className="text-button" onClick={onQuick}>
          {t('I only need one activity →', 'मुझे केवल एक गतिविधि चाहिए →')}
        </button>
      </section>
    </>
  )
}
