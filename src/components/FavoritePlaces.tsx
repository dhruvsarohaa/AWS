import { useRef, useState } from 'react'
import type { DashboardData, FavoritePlace, Language, Place } from '../types.ts'
import { reviewedLocation } from '../lib/decision-evidence.ts'
import { say } from '../lib/labels.ts'
import { validDashboardForPlace } from '../lib/contracts.ts'
import {
  createFavorite,
  deleteFavorite,
  renameFavorite,
  upsertFavorite,
} from '../lib/favorites.ts'
export default function FavoritePlaces({
  ...props
}: Parameters<typeof FavoritePlacesForm>[0]) {
  return (
    <FavoritePlacesForm key={reviewedLocation(props.place).key} {...props} />
  )
}
function FavoritePlacesForm({
  places,
  place,
  data,
  language,
  disabled,
  onSave,
  onSelect,
}: {
  places: FavoritePlace[]
  place: Place
  data: DashboardData | null
  language: Language
  disabled: boolean
  onSave: (p: FavoritePlace[]) => Promise<'saved' | 'session' | 'conflict'>
  onSelect: (p: Place) => void
}) {
  const [label, setLabel] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [renaming, setRenaming] = useState<{ id: string; label: string } | null>(
      null,
    )
  const t = (en: string, hi: string) => say(language, en, hi)
  const saving = useRef(false)
  const coarse: Place = {
    name: place.name,
    state: place.state,
    country: 'India',
    latitude: Math.round(place.latitude * 10) / 10,
    longitude: Math.round(place.longitude * 10) / 10,
    confirmed: true,
  }
  const id = reviewedLocation(coarse).key
  async function save(next: FavoritePlace[]) {
    if (saving.current || disabled) return
    saving.current = true
    setBusy(true)
    setMessage('')
    try {
      const result = await onSave(next)
      setMessage(
        result === 'saved'
          ? t('Saved in this browser.', 'इस ब्राउज़र में सहेजा गया।')
          : result === 'session'
            ? t(
                'Session only; export before leaving.',
                'केवल इस सत्र में; जाने से पहले निर्यात करें।',
              )
            : t(
                'Not saved: resolve the storage conflict.',
                'नहीं सहेजा गया: संग्रह समस्या हल करें।',
              ),
      )
      if (result !== 'conflict') {
        setLabel('')
        setRenaming(null)
      }
    } catch {
      setMessage(
        t(
          'Could not save. Your existing places remain.',
          'सहेज नहीं पाए। पुराने स्थान सुरक्षित हैं।',
        ),
      )
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <section id="saved-places" tabIndex={-1} className="card favorite-places">
      <h2 id="saved-places-title" tabIndex={-1}>
        {t('Saved places', 'सहेजे गए स्थान')}
      </h2>
      <p className="help-text">
        {t(
          'Up to five places, kept only in this browser. Saved areas use coordinates rounded to 0.1°; exact detected GPS is not retained here. Switching loads only the selected area. Existing journal entries remain in History.',
          'पांच स्थान तक, केवल इस ब्राउज़र में। स्थान 0.1° तक गोल किए जाते हैं; सटीक GPS यहां नहीं रखा जाता। बदलने पर केवल चुना स्थान लोड होता है। पुराने निर्णय इतिहास में रहते हैं।',
        )}
      </p>
      <p className="help-text">
        {t(
          'Selecting a rounded saved area creates its own review context. Decisions made at a more precise location remain under their original location in History; they are not silently treated as decisions for this rounded area.',
          'गोल किए सहेजे क्षेत्र को चुनने पर उसका अलग समीक्षा संदर्भ बनता है। अधिक सटीक स्थान के निर्णय इतिहास में उनके मूल स्थान पर रहते हैं; उन्हें इस गोल क्षेत्र के निर्णय नहीं माना जाता।',
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (
            !disabled &&
            !busy &&
            place.confirmed &&
            label.trim() &&
            (places.length < 5 || places.some((p) => p.id === id))
          )
            void save(upsertFavorite(places, createFavorite(place, label)))
        }}
      >
        <div className="r2-form-row">
          <label>
            {t('Name this selected area', 'चुने क्षेत्र का नाम')}
            <input
              maxLength={80}
              required
              value={label}
              disabled={disabled || busy || !place.confirmed}
              placeholder={place.name}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="button primary"
            disabled={
              disabled ||
              busy ||
              !place.confirmed ||
              !label.trim() ||
              (places.length >= 5 && !places.some((p) => p.id === id))
            }
          >
            {places.some((p) => p.id === id)
              ? t('Rename selected area', 'क्षेत्र का नाम बदलें')
              : t('Save selected area', 'क्षेत्र सहेजें')}
          </button>
        </div>
      </form>
      {!place.confirmed && (
        <p>{t('Confirm a location first.', 'पहले स्थान की पुष्टि करें।')}</p>
      )}
      <ul className="favorites-list">
        {places.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => onSelect(p.place)}
            >
              {p.label}
              <small>
                {p.place.name} · {p.place.state}
              </small>
            </button>
            {renaming?.id === p.id ? (
              <form
                className="r2-form-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (renaming.label.trim() && !busy && !disabled)
                    void save(renameFavorite(places, p.id, renaming.label))
                }}
              >
                <label>
                  {t('New saved name', 'नया सहेजा नाम')}
                  <input
                    value={renaming.label}
                    maxLength={80}
                    required
                    disabled={disabled || busy}
                    onChange={(e) =>
                      setRenaming({ id: p.id, label: e.target.value })
                    }
                  />
                </label>
                <button
                  type="submit"
                  className="button secondary"
                  disabled={disabled || busy || !renaming.label.trim()}
                >
                  {t('Save name', 'नाम सहेजें')}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => setRenaming(null)}
                >
                  {t('Cancel', 'रद्द करें')}
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="text-button"
                disabled={disabled || busy}
                aria-label={`${t('Rename saved place', 'सहेजा स्थान नाम बदलें')} ${p.label}`}
                onClick={() => setRenaming({ id: p.id, label: p.label })}
              >
                {t('Rename', 'नाम बदलें')}
              </button>
            )}
            <button
              type="button"
              className="text-button"
              disabled={disabled || busy}
              aria-label={`${t('Delete saved place', 'सहेजा स्थान हटाएं')} ${p.label}`}
              onClick={() => void save(deleteFavorite(places, p.id))}
            >
              {t('Delete', 'हटाएं')}
            </button>
          </li>
        ))}
      </ul>
      {!places.length && (
        <p className="empty-message">
          {t('No saved places yet.', 'अभी कोई सहेजा स्थान नहीं।')}
        </p>
      )}
      {data && validDashboardForPlace(data, place) && (
        <p className="help-text">
          {t('Selected area only', 'केवल चयनित क्षेत्र')}:{' '}
          {data.coverage?.returnedStationCount ?? data.monitors.length}{' '}
          {t('returned stations', 'मिले स्टेशन')} ·{' '}
          {data.sources.forecast?.status || 'unavailable'} ·{' '}
          {t(
            'A lookup does not guarantee a nearby current monitor.',
            'खोज पास में वर्तमान मापन की गारंटी नहीं है।',
          )}
        </p>
      )}
      <p role="status">{message}</p>
    </section>
  )
}
