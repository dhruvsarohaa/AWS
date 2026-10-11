import type { FavoritePlace, Language, Place } from '../types.ts'
import { addDays, dateInIndia } from '../lib/planner.ts'
import { say } from '../lib/labels.ts'
export default function ContextBar({
  place,
  date,
  now,
  language,
  loading,
  networkOffline = false,
  disabled,
  onPlace,
  onDate,
  onRefresh,
  onLanguage,
  favorites,
  onSelectFavorite,
}: {
  place: Place
  date: string
  now: number
  language: Language
  loading: boolean
  networkOffline?: boolean
  disabled: boolean
  onPlace: () => void
  onDate: (date: string) => void
  onRefresh: () => void
  onLanguage: (language: Language) => void
  favorites: FavoritePlace[]
  onSelectFavorite: (place: Place) => void
}) {
  const today = dateInIndia(now),
    t = (en: string, hi: string) => say(language, en, hi)
  return (
    <div className="context-bar">
      <button
        type="button"
        className="context-place"
        onClick={onPlace}
        aria-label={t('Choose or change location', 'स्थान चुनें या बदलें')}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="context-icon">
          <path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
        <span>
          <strong>{place.name}</strong>
          <small>
            {place.confirmed
              ? place.state ||
                t('Saved device position', 'सहेजा गया डिवाइस स्थान')
              : t(
                  'Delhi preview · choose your place',
                  'दिल्ली पूर्वावलोकन · अपना स्थान चुनें',
                )}
          </small>
        </span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="context-chevron">
          <path d="m8 10 4 4 4-4" />
        </svg>
      </button>
      {favorites.length > 0 && (
        <details className="context-saved">
          <summary aria-label={t('Saved areas', 'सहेजे क्षेत्र')}>
            <svg
              aria-hidden="true"
              className="context-icon"
              viewBox="0 0 24 24"
            >
              <path d="M6 3h12v18l-6-4-6 4Z" />
            </svg>
            <span>{t('Saved', 'सहेजे')}</span>
          </summary>
          <label className="context-favorites">
            <span>{t('Saved areas', 'सहेजे क्षेत्र')}</span>
            <select
              value=""
              disabled={disabled}
              onChange={(e) => {
                const f = favorites.find((p) => p.id === e.target.value)
                if (f) {
                  const disclosure = e.currentTarget.closest('details')
                  if (disclosure) disclosure.open = false
                  onSelectFavorite(f.place)
                }
              }}
            >
              <option value="">{t('Switch area…', 'क्षेत्र बदलें…')}</option>
              {favorites.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </details>
      )}
      <label className="context-date">
        <span>{t('Plan date · IST', 'योजना की तारीख · IST')}</span>
        <select value={date} onChange={(e) => onDate(e.target.value)}>
          {[today, addDays(today, 1), addDays(today, 2)].map((d) => (
            <option key={d} value={d}>
              {d === today
                ? `${t('Today', 'आज')} · `
                : d === addDays(today, 1)
                  ? `${t('Tomorrow', 'कल')} · `
                  : ''}
              {new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', {
                month: 'short',
                day: 'numeric',
                timeZone: 'Asia/Kolkata',
              }).format(new Date(`${d}T12:00:00Z`))}
            </option>
          ))}
        </select>
      </label>
      <label className="context-language">
        <span>{t('Language', 'भाषा')}</span>
        <select
          value={language}
          disabled={disabled}
          onChange={(e) => onLanguage(e.target.value as Language)}
        >
          <option value="en">English</option>
          <option value="hi">हिन्दी</option>
        </select>
      </label>
      <button
        className="button secondary context-refresh"
        type="button"
        aria-label={
          loading
            ? t('Updating…', 'अपडेट हो रहा है…')
            : t('Refresh', 'रीफ़्रेश')
        }
        aria-busy={loading}
        disabled={loading || networkOffline}
        onClick={onRefresh}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={loading ? 'context-icon refreshing' : 'context-icon'}
        >
          <path d="M20 7v5h-5M4 17v-5h5M5.3 8a7 7 0 0 1 11.5-3L20 8M4 16l3.2 3A7 7 0 0 0 18.7 16" />
        </svg>
        <span className="context-refresh-label">
          {loading
            ? t('Updating…', 'अपडेट हो रहा है…')
            : t('Refresh', 'रीफ़्रेश')}
        </span>
      </button>
    </div>
  )
}
