import type { Language } from '../types.ts'
import { say } from '../lib/labels.ts'
export default function SetupStepper({
  confirmed,
  hasActivity,
  language,
  onPlace,
  onQuick,
  onTemplate,
}: {
  confirmed: boolean
  hasActivity: boolean
  language: Language
  onPlace: () => void
  onQuick: () => void
  onTemplate: () => void
}) {
  const t = (en: string, hi: string) => say(language, en, hi)
  if (confirmed && hasActivity) return null
  return (
    <details className="card setup-stepper">
      <summary>
        <h2 id="setup-title">
          {t(
            'Your first plan, in three steps',
            'आपकी पहली योजना, तीन चरणों में',
          )}
        </h2>
        <span>
          {confirmed
            ? t('Place confirmed', 'स्थान की पुष्टि हो गई')
            : t('Get started', 'शुरू करें')}
        </span>
      </summary>
      <ol>
        <li className={confirmed ? 'done' : 'active'}>
          <span>1</span>
          <div>
            <strong>{t('Confirm your place', 'स्थान की पुष्टि करें')}</strong>
            <p>
              {confirmed
                ? t('Place confirmed', 'स्थान की पुष्टि हो गई')
                : t(
                    'Use device location or choose an Indian city.',
                    'डिवाइस स्थान या भारतीय शहर चुनें।',
                  )}
            </p>
          </div>
        </li>
        <li className={confirmed ? 'active' : ''}>
          <span>2</span>
          <div>
            <strong>{t('Choose an activity', 'गतिविधि चुनें')}</strong>
            <p>
              {t(
                'One activity or an editable template.',
                'एक गतिविधि या बदलने योग्य उदाहरण।',
              )}
            </p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <strong>
              {t(
                'Review your rule & allowed times',
                'सीमा और उपलब्ध समय की समीक्षा',
              )}
            </strong>
            <p>
              {t(
                'Confirm the settings, then compare evidence.',
                'सेटिंग्स की पुष्टि करें, फिर डेटा की तुलना करें।',
              )}
            </p>
          </div>
        </li>
      </ol>
      <div className="button-row">
        {!confirmed ? (
          <button type="button" className="button primary" onClick={onPlace}>
            {t('Choose location', 'स्थान चुनें')}
          </button>
        ) : (
          <>
            <button type="button" className="button primary" onClick={onQuick}>
              {t('Plan one activity', 'एक गतिविधि की योजना')}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={onTemplate}
            >
              {t('Use a template', 'उदाहरण चुनें')}
            </button>
            <button type="button" className="text-button" onClick={onPlace}>
              {t('Back to location', 'स्थान पर वापस जाएं')}
            </button>
          </>
        )}
      </div>
    </details>
  )
}
