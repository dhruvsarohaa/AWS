import { useState } from 'react'
import type { LocalState, Place } from '../types.ts'
import type { LocalGroup, SharedGroup } from '../lib/groups.ts'
import { say } from '../lib/labels.ts'
export function LocalGroups({
  state,
  disabled,
  onCommit,
  onSelect,
}: {
  state: LocalState
  disabled: boolean
  onCommit: (state: LocalState) => Promise<'saved' | 'session' | 'conflict'>
  onSelect: (p: Place) => void
}) {
  const [name, setName] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [edit, setEdit] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const groups = state.groups || [],
    t = (en: string, hi: string) => say(state.language, en, hi)
  async function save(next: LocalGroup[]) {
    setBusy(true)
    try {
      const result = await onCommit({ ...state, groups: next })
      setNotice(
        result === 'saved'
          ? t('Groups saved.', 'समूह सहेजे गए।')
          : result === 'session'
            ? t(
                'Session only; export before leaving.',
                'केवल इस सत्र में; निर्यात करें।',
              )
            : 'Resolve storage conflict first.',
      )
      if (result !== 'conflict') {
        setName('')
        setSelected([])
        setEdit('')
      }
    } catch {
      setNotice('Could not save groups.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card" id="area-groups" tabIndex={-1}>
      <h2>{t('Area groups', 'क्षेत्र समूह')}</h2>
      <p className="help-text">
        {t(
          'Group saved places in this browser. Selecting a site loads that area only; groups do not establish campus measurement coverage.',
          'सहेजे स्थानों के समूह बनाएं। केवल चुना क्षेत्र लोड होता है; समूह परिसर मापन की पुष्टि नहीं करता।',
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save([
            ...groups.filter((g) => g.id !== edit),
            {
              id: edit || crypto.randomUUID(),
              name: name.trim(),
              placeIds: selected,
            },
          ])
        }}
      >
        <label>
          {t('Group name', 'समूह का नाम')}
          <input
            required
            maxLength={80}
            disabled={disabled || busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset disabled={disabled || busy}>
          <legend>
            {t('Saved sites · up to five', 'सहेजे स्थान · पांच तक')}
          </legend>
          {state.favorites.map((f) => (
            <label className="radio-option" key={f.id}>
              <input
                type="checkbox"
                checked={selected.includes(f.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, f.id]
                      : selected.filter((id) => id !== f.id),
                  )
                }
              />
              {f.label}
            </label>
          ))}
        </fieldset>
        <button
          className="button secondary"
          disabled={
            disabled ||
            busy ||
            !name.trim() ||
            !selected.length ||
            (!edit && groups.length >= 10)
          }
        >
          {edit
            ? t('Save group', 'समूह सहेजें')
            : t('Create group', 'समूह बनाएं')}
        </button>
        {edit && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setEdit('')
              setName('')
              setSelected([])
            }}
          >
            Cancel edit
          </button>
        )}
      </form>
      {groups.map((g) => (
        <div key={g.id} className="group-row">
          <strong>{g.name}</strong>
          <div className="button-row">
            {g.placeIds
              .map((id) => state.favorites.find((f) => f.id === id))
              .map(
                (f) =>
                  f && (
                    <button
                      className="button secondary"
                      type="button"
                      key={f.id}
                      disabled={disabled || busy}
                      onClick={() => onSelect(f.place)}
                    >
                      {f.label}
                    </button>
                  ),
              )}
            <button
              className="text-button"
              type="button"
              disabled={disabled || busy}
              onClick={() => {
                setEdit(g.id)
                setName(g.name)
                setSelected(g.placeIds)
              }}
            >
              Edit
            </button>
            <button
              className="text-button"
              type="button"
              disabled={disabled || busy}
              onClick={() => void save(groups.filter((x) => x.id !== g.id))}
            >
              Delete group
            </button>
          </div>
        </div>
      ))}
      {!state.favorites.length && (
        <p>{t('Save a favorite place first.', 'पहले पसंदीदा स्थान सहेजें।')}</p>
      )}
      <p role="status">{notice}</p>
    </section>
  )
}
export function SharedGroups({
  groups,
  place,
  disabled,
  onSave,
  onSelect,
}: {
  groups: SharedGroup[]
  place?: Place
  disabled: boolean
  onSave: (groups: SharedGroup[]) => void
  onSelect?: (p: Place) => void
}) {
  const [name, setName] = useState(''),
    [groupId, setGroupId] = useState('')
  const site = place
    ? {
        name: place.detected ? 'Selected area' : place.name,
        state: place.state,
        country: 'India',
        latitude: Math.round(place.latitude * 10) / 10,
        longitude: Math.round(place.longitude * 10) / 10,
        confirmed: true,
      }
    : null
  return (
    <section>
      <h3>Shared area groups</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!site) return
          const current = groups.find((g) => g.id === groupId)
          onSave(
            current
              ? groups.map((g) =>
                  g.id === groupId ? { ...g, sites: [...g.sites, site] } : g,
                )
              : [
                  ...groups,
                  { id: crypto.randomUUID(), name: name.trim(), sites: [site] },
                ],
          )
        }}
      >
        <label>
          Add selected area to
          <select
            value={groupId}
            disabled={disabled}
            onChange={(e) => setGroupId(e.target.value)}
          >
            <option value="">New group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {!groupId && (
          <label>
            New group name
            <input
              maxLength={80}
              required
              value={name}
              disabled={disabled}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <button
          className="button secondary"
          disabled={
            disabled ||
            !place?.confirmed ||
            (!groupId && (!name.trim() || groups.length >= 10)) ||
            (groups.find((g) => g.id === groupId)?.sites.length || 0) >= 5
          }
        >
          Add selected coarse area
        </button>
      </form>
      {groups.map((g) => (
        <div className="group-row" key={g.id}>
          <strong>{g.name}</strong>
          <div className="button-row">
            {g.sites.map((p, i) => (
              <span key={`${p.latitude},${p.longitude}`}>
                <button
                  className="button secondary"
                  type="button"
                  disabled={!onSelect}
                  onClick={() => onSelect?.(p)}
                >
                  {p.name}
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${p.name} from ${g.name}`}
                  onClick={() =>
                    onSave(
                      g.sites.length === 1
                        ? groups.filter((x) => x.id !== g.id)
                        : groups.map((x) =>
                            x.id === g.id
                              ? {
                                  ...x,
                                  sites: x.sites.filter((_, j) => i !== j),
                                }
                              : x,
                          ),
                    )
                  }
                >
                  Remove
                </button>
              </span>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
