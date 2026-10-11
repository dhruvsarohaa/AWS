import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { EXAMPLE_THRESHOLD, validatePlan, WEEKDAYS } from '../lib/planner.ts'
import { say } from '../lib/labels.ts'
import type { Activity, Language, OutdoorPlan } from '../types.ts'

type Props = {
  plan: OutdoorPlan
  language?: Language
  onSave: (plan: OutdoorPlan) => Promise<void>
  onClose: () => void
}
export default function PlanEditor({
  plan,
  language = 'en',
  onSave,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(() => structuredClone(plan))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [discarding, setDiscarding] = useState(false)
  const [removed, setRemoved] = useState<
    { activity: Activity; index: number }[]
  >([])
  const [editNotice, setEditNotice] = useState('')
  const [busy, setBusy] = useState(false),
    [saveError, setSaveError] = useState('')
  const t = (en: string, hi: string) => say(language, en, hi)
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan)

  useEffect(() => {
    const element = dialog.current
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element?.showModal()
    element?.querySelector<HTMLInputElement>('#plan-name')?.focus()
    return () => {
      element?.close()
      document.body.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])

  function requestClose() {
    if (busy) return
    if (dirty) setDiscarding(true)
    else onClose()
  }
  function focusField(id: string) {
    const field = document.getElementById(id)
    let ancestor = field?.parentElement
    while (ancestor) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
      ancestor = ancestor.parentElement
    }
    field?.focus()
  }
  function updateActivity(id: string, changes: Partial<Activity>) {
    setDraft((current) => ({
      ...current,
      activities: current.activities.map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
    }))
  }
  function addActivity() {
    const id = crypto.randomUUID()
    setDraft((current) => ({
      ...current,
      activities: [
        ...current.activities,
        {
          id,
          start: '10:00',
          end: '11:00',
          activity: '',
          place: '',
          days: [1, 2, 3, 4, 5],
        },
      ],
    }))
    requestAnimationFrame(() => focusField(`${id}-name`))
    setEditNotice('Activity added. Enter its name, place, times, and days.')
  }
  function removeActivity(id: string) {
    const index = draft.activities.findIndex((item) => item.id === id)
    const activity = draft.activities[index]
    setRemoved((items) => [
      ...items,
      { activity: structuredClone(activity), index },
    ])
    setDraft((current) => ({
      ...current,
      activities: current.activities.filter((item) => item.id !== id),
    }))
    setErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`${id}-`)),
      ),
    )
    setEditNotice(
      `${activity.activity || 'Activity'} removed. Undo is available.`,
    )
    requestAnimationFrame(() => document.getElementById('undo-remove')?.focus())
  }
  function undoRemove() {
    const item = removed.at(-1)
    if (!item) return
    setDraft((current) => {
      const activities = [...current.activities]
      activities.splice(
        Math.min(item.index, activities.length),
        0,
        item.activity,
      )
      return { ...current, activities }
    })
    setRemoved((items) => items.slice(0, -1))
    setEditNotice(`${item.activity.activity || 'Activity'} restored.`)
    requestAnimationFrame(() => focusField(`${item.activity.id}-name`))
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const clean = {
      ...draft,
      name: draft.name.trim(),
      configured: true,
      activities: draft.activities.map((item) => ({
        ...item,
        activity: item.activity.trim(),
        place: item.place.trim(),
        days: [...new Set(item.days)].sort(),
      })),
    }
    const nextErrors = validatePlan(clean)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => focusField(Object.keys(nextErrors)[0]))
      return
    }
    setSaveError('')
    setBusy(true)
    try {
      await onSave(clean)
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : 'The plan could not save. Your draft is retained.',
      )
    } finally {
      setBusy(false)
    }
  }
  function messageLabel(message: string) {
    const labels: Record<string, string> = {
      'Enter a name up to 80 characters.': '80 अक्षरों तक का नाम भरें।',
      'Use up to 50 activities with unique IDs.':
        'अलग पहचान वाली अधिकतम 50 गतिविधियां रखें।',
      'Choose a number from 1 to 1000 µg/m³.':
        '1 से 1000 µg/m³ के बीच मान चुनें।',
      'Name this activity.': 'गतिविधि का नाम भरें।',
      'Enter where this activity takes place.': 'गतिविधि का स्थान भरें।',
      'Enter a valid start time.': 'सही शुरुआत का समय भरें।',
      'Enter a valid end time.': 'सही समाप्ति का समय भरें।',
      'End time must be after start time on the same day.':
        'समाप्ति उसी दिन शुरुआत के बाद होनी चाहिए।',
      'Choose at least one day.': 'कम से कम एक दिन चुनें।',
      'Choose an allowed time range that can fit this activity.':
        'ऐसी अनुमत समय सीमा चुनें जिसमें गतिविधि पूरी हो।',
    }
    return language === 'hi' ? labels[message] || message : message
  }
  function errorProps(id: string) {
    return {
      'aria-invalid': Boolean(errors[id]),
      'aria-describedby': errors[id] ? `${id}-error` : undefined,
    }
  }
  function fieldError(id: string) {
    return errors[id] ? (
      <span id={`${id}-error`} className="field-error">
        {messageLabel(errors[id])}
      </span>
    ) : null
  }
  function errorLabel(id: string, message: string) {
    const index = draft.activities.findIndex((item) =>
      id.startsWith(`${item.id}-`),
    )
    return index < 0
      ? message
      : `${draft.activities[index].activity || `Activity ${index + 1}`}: ${message}`
  }

  return (
    <dialog
      ref={dialog}
      className="plan-dialog"
      aria-labelledby="plan-title"
      aria-describedby="plan-description"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
    >
      <div className="dialog-heading">
        <div>
          <h2 id="plan-title">
            {plan.configured
              ? t('Edit your plan', 'योजना बदलें')
              : t('Make this plan yours', 'अपनी योजना बनाएं')}
          </h2>
          <p id="plan-description">
            {t(
              'Choose your recurring activities and a review rule. Your plan stays in this browser.',
              'नियमित गतिविधियां और समीक्षा सीमा चुनें। योजना इसी ब्राउज़र में रहती है।',
            )}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Close plan editor', 'योजना संपादक बंद करें')}
          onClick={requestClose}
          disabled={busy}
        >
          ×
        </button>
      </div>
      {discarding && (
        <div className="discard-panel" role="alert">
          <strong>
            {t(
              'You have unsaved changes.',
              'आपके बदलाव अभी सहेजे नहीं गए हैं।',
            )}
          </strong>
          <p>
            {t(
              'Keep editing or discard the changes made since opening this form.',
              'संपादन जारी रखें या यह फ़ॉर्म खोलने के बाद के बदलाव छोड़ें।',
            )}
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button primary"
              autoFocus
              onClick={() => {
                setDiscarding(false)
                focusField('plan-name')
              }}
            >
              {t('Keep editing', 'संपादन जारी रखें')}
            </button>
            <button type="button" className="button danger" onClick={onClose}>
              {t('Discard changes', 'बदलाव छोड़ें')}
            </button>
          </div>
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <fieldset className="editor-fieldset" disabled={busy}>
          {Object.keys(errors).length > 0 && (
            <div className="form-error-summary" role="alert">
              <strong>
                {t('Check the highlighted fields.', 'चिह्नित फ़ील्ड देखें।')}
              </strong>
              <ul>
                {Object.entries(errors).map(([id, message]) => (
                  <li key={id}>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => focusField(id)}
                    >
                      {errorLabel(id, messageLabel(message))}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="field" htmlFor="plan-name">
            {t('Plan name', 'योजना का नाम')}
            <input
              id="plan-name"
              maxLength={80}
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              {...errorProps('plan-name')}
            />
            {fieldError('plan-name')}
          </label>
          <fieldset className="rule-settings">
            <legend>
              {t(
                'When should an activity need review?',
                'गतिविधि की समीक्षा कब चाहिए?',
              )}
            </legend>
            <p>
              {t(
                'PM2.5 means fine particles in the air. The number below is a concentration in micrograms per cubic metre (µg/m³).',
                'PM2.5 हवा में महीन कण हैं। नीचे का मान माइक्रोग्राम प्रति घन मीटर (µg/m³) में सांद्रता है।',
              )}
            </p>
            <label className="radio-option">
              <input
                type="radio"
                name="rule-mode"
                checked={draft.ruleMode === 'example'}
                onChange={() =>
                  setDraft((current) => ({
                    ...current,
                    ruleMode: 'example',
                    threshold: EXAMPLE_THRESHOLD,
                  }))
                }
              />
              <span>
                {t(
                  'Use the example review rule',
                  'उदाहरण समीक्षा सीमा इस्तेमाल करें',
                )}{' '}
                · {EXAMPLE_THRESHOLD} µg/m³
              </span>
            </label>
            <label className="radio-option">
              <input
                type="radio"
                name="rule-mode"
                checked={draft.ruleMode !== 'example'}
                onChange={() =>
                  setDraft((current) => ({ ...current, ruleMode: 'custom' }))
                }
              />
              <span>
                {t('Set my own review threshold', 'अपनी समीक्षा सीमा चुनें')}
              </span>
            </label>
            <label className="field" htmlFor="plan-threshold">
              {t(
                'PM2.5 review threshold · µg/m³',
                'PM2.5 समीक्षा सीमा · µg/m³',
              )}
              <input
                id="plan-threshold"
                type="number"
                min={1}
                max={1000}
                step="any"
                inputMode="decimal"
                disabled={draft.ruleMode === 'example'}
                value={Number.isFinite(draft.threshold) ? draft.threshold : ''}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    threshold:
                      event.target.value === ''
                        ? NaN
                        : Number(event.target.value),
                  }))
                }
                {...errorProps('plan-threshold')}
                aria-describedby={
                  errors['plan-threshold']
                    ? 'plan-threshold-error rule-explanation'
                    : 'rule-explanation'
                }
              />
              {fieldError('plan-threshold')}
            </label>
            <p id="rule-explanation" className="help-text">
              {t(
                'The example value of 75 is an illustrative app setting, not a recommended health limit. For example, a forecast of 80 with a rule of 75 flags the activity for review. We use the highest available hourly forecast in its time window. Values below your rule do not establish safe conditions. This hourly model rule is not an official Indian AQI category.',
                '75 का उदाहरण केवल ऐप की सेटिंग है, सुझाई स्वास्थ्य सीमा नहीं। उदाहरण के लिए 75 की सीमा में 80 का पूर्वानुमान समीक्षा दिखाता है। गतिविधि के समय का सबसे अधिक उपलब्ध प्रति घंटा मान लिया जाता है। सीमा से कम मान सुरक्षित स्थिति नहीं साबित करते। यह आधिकारिक भारतीय AQI श्रेणी नहीं है।',
              )}
            </p>
          </fieldset>
          <div className="section-heading">
            <h3>
              {t('Recurring outdoor activities', 'नियमित बाहरी गतिविधियां')}
            </h3>
            <button
              className="button secondary"
              type="button"
              onClick={addActivity}
              disabled={draft.activities.length >= 50}
            >
              {t('+ Add activity', '+ गतिविधि जोड़ें')}
            </button>
          </div>
          <div className="editor-notice" aria-live="polite">
            <span>{editNotice}</span>
            {removed.length > 0 && (
              <button
                id="undo-remove"
                className="button secondary"
                type="button"
                onClick={undoRemove}
              >
                {t('Undo removal', 'हटाना वापस लें')}
              </button>
            )}
          </div>
          {!draft.activities.length && (
            <p className="empty-message">
              {t(
                'No activities yet. Add a commute, walk, school PE session, or another outdoor activity.',
                'अभी कोई गतिविधि नहीं। यात्रा, सैर, स्कूल PE या अन्य बाहरी गतिविधि जोड़ें।',
              )}
            </p>
          )}
          <div className="plan-activity-list">
            {draft.activities.map((activity, index) => (
              <fieldset className="plan-activity" key={activity.id}>
                <legend>{activity.activity || `Activity ${index + 1}`}</legend>
                <button
                  type="button"
                  className="button danger remove-activity"
                  aria-label={`Remove ${activity.activity || `activity ${index + 1}`}`}
                  onClick={() => removeActivity(activity.id)}
                >
                  {t('Remove', 'हटाएं')}
                </button>
                <div className="field-grid">
                  <label className="field" htmlFor={`${activity.id}-name`}>
                    {t('Activity name', 'गतिविधि का नाम')}
                    <input
                      id={`${activity.id}-name`}
                      maxLength={80}
                      value={activity.activity}
                      onChange={(event) =>
                        updateActivity(activity.id, {
                          activity: event.target.value,
                        })
                      }
                      placeholder="e.g. Evening walk"
                      {...errorProps(`${activity.id}-name`)}
                    />
                    {fieldError(`${activity.id}-name`)}
                  </label>
                  <label className="field" htmlFor={`${activity.id}-place`}>
                    {t('Place', 'स्थान')}
                    <input
                      id={`${activity.id}-place`}
                      maxLength={80}
                      value={activity.place}
                      onChange={(event) =>
                        updateActivity(activity.id, {
                          place: event.target.value,
                        })
                      }
                      placeholder="e.g. Sports field"
                      {...errorProps(`${activity.id}-place`)}
                    />
                    {fieldError(`${activity.id}-place`)}
                  </label>
                  <label className="field" htmlFor={`${activity.id}-start`}>
                    {t('Starts at · IST', 'शुरू · IST')}
                    <input
                      id={`${activity.id}-start`}
                      type="time"
                      value={activity.start}
                      onInput={(event) =>
                        updateActivity(activity.id, {
                          start: event.currentTarget.value,
                        })
                      }
                      onChange={(event) =>
                        updateActivity(activity.id, {
                          start: event.target.value,
                        })
                      }
                      {...errorProps(`${activity.id}-start`)}
                    />
                    {fieldError(`${activity.id}-start`)}
                  </label>
                  <label className="field" htmlFor={`${activity.id}-end`}>
                    {t('Ends at · IST', 'समाप्त · IST')}
                    <input
                      id={`${activity.id}-end`}
                      type="time"
                      value={activity.end}
                      onInput={(event) =>
                        updateActivity(activity.id, {
                          end: event.currentTarget.value,
                        })
                      }
                      onChange={(event) =>
                        updateActivity(activity.id, { end: event.target.value })
                      }
                      {...errorProps(`${activity.id}-end`)}
                    />
                    {fieldError(`${activity.id}-end`)}
                  </label>
                </div>
                <details className="advanced-activity">
                  <summary>
                    {t(
                      'Repeat days & practical alternatives',
                      'नियमित दिन और व्यावहारिक विकल्प',
                    )}{' '}
                    ·{' '}
                    {activity.days
                      .map((day) =>
                        language === 'hi'
                          ? [
                              'रवि',
                              'सोम',
                              'मंगल',
                              'बुध',
                              'गुरु',
                              'शुक्र',
                              'शनि',
                            ][day]
                          : WEEKDAYS[day],
                      )
                      .join(', ') || t('No days selected', 'दिन नहीं चुने गए')}
                  </summary>
                  <p className="help-text">
                    {activity.flexible
                      ? `${t('Allowed times', 'अनुमत समय')}: ${activity.allowedStart || activity.start}–${activity.allowedEnd || activity.end} IST`
                      : t(
                          'Fixed time; enable flexibility to compare alternatives.',
                          'निश्चित समय; विकल्पों की तुलना के लिए समय बदलने की अनुमति दें।',
                        )}
                  </p>
                  <fieldset className="activity-constraints">
                    <legend>
                      {t('Practical alternatives', 'व्यावहारिक विकल्प')}
                    </legend>
                    <label className="radio-option">
                      <input
                        type="checkbox"
                        checked={Boolean(activity.flexible)}
                        onChange={(event) =>
                          updateActivity(activity.id, {
                            flexible: event.target.checked,
                            allowedStart:
                              activity.allowedStart || activity.start,
                            allowedEnd: activity.allowedEnd || activity.end,
                          })
                        }
                      />
                      {t(
                        'This activity can move within an allowed time range',
                        'यह गतिविधि अनुमत समय में बदली जा सकती है',
                      )}
                    </label>
                    {activity.flexible && (
                      <div className="field-grid">
                        <label
                          className="field"
                          htmlFor={`${activity.id}-allowed-start`}
                        >
                          {t(
                            'Earliest allowed start · IST',
                            'सबसे पहले अनुमत शुरुआत · IST',
                          )}
                          <input
                            id={`${activity.id}-allowed-start`}
                            type="time"
                            value={activity.allowedStart || activity.start}
                            onInput={(event) =>
                              updateActivity(activity.id, {
                                allowedStart: event.currentTarget.value,
                              })
                            }
                            onChange={(event) =>
                              updateActivity(activity.id, {
                                allowedStart: event.target.value,
                              })
                            }
                            {...errorProps(`${activity.id}-allowed-start`)}
                          />
                          {fieldError(`${activity.id}-allowed-start`)}
                        </label>
                        <label className="field">
                          {t(
                            'Latest allowed finish · IST',
                            'सबसे बाद अनुमत समाप्ति · IST',
                          )}
                          <input
                            type="time"
                            value={activity.allowedEnd || activity.end}
                            onInput={(event) =>
                              updateActivity(activity.id, {
                                allowedEnd: event.currentTarget.value,
                              })
                            }
                            onChange={(event) =>
                              updateActivity(activity.id, {
                                allowedEnd: event.target.value,
                              })
                            }
                          />
                        </label>
                      </div>
                    )}
                    <label className="radio-option">
                      <input
                        type="checkbox"
                        checked={Boolean(activity.indoorAvailable)}
                        onChange={(event) =>
                          updateActivity(activity.id, {
                            indoorAvailable: event.target.checked,
                          })
                        }
                      />
                      {t(
                        'A suitable indoor alternative is available',
                        'उपयुक्त अंदर का विकल्प उपलब्ध है',
                      )}
                    </label>
                    <label className="field">
                      {t('Activity intensity', 'गतिविधि की तीव्रता')}
                      <select
                        value={activity.intensity || 'moderate'}
                        onChange={(event) =>
                          updateActivity(activity.id, {
                            intensity: event.target
                              .value as Activity['intensity'],
                          })
                        }
                      >
                        <option value="low">
                          {t(
                            'Low · sitting or gentle movement',
                            'कम · बैठना या हल्की गतिविधि',
                          )}
                        </option>
                        <option value="moderate">
                          {t(
                            'Moderate · walking or light work',
                            'मध्यम · चलना या हल्का काम',
                          )}
                        </option>
                        <option value="high">
                          {t(
                            'High · sports or strenuous work',
                            'अधिक · खेल या मेहनत का काम',
                          )}
                        </option>
                      </select>
                    </label>
                    <p className="help-text">
                      {t(
                        'Intensity is recorded as context. The app does not calculate inhaled dose or verify indoor air.',
                        'तीव्रता संदर्भ के लिए दर्ज है। ऐप सांस में गई मात्रा या अंदर की हवा का सत्यापन नहीं करता।',
                      )}
                    </p>
                  </fieldset>
                  <fieldset
                    className="day-pickers"
                    id={`${activity.id}-days`}
                    tabIndex={errors[`${activity.id}-days`] ? -1 : undefined}
                    {...errorProps(`${activity.id}-days`)}
                  >
                    <legend>{t('Runs on', 'इन दिनों')}</legend>
                    {WEEKDAYS.map((day, dayIndex) => (
                      <label key={day}>
                        <input
                          type="checkbox"
                          checked={activity.days.includes(dayIndex)}
                          onChange={(event) =>
                            updateActivity(activity.id, {
                              days: event.target.checked
                                ? [...activity.days, dayIndex]
                                : activity.days.filter(
                                    (value) => value !== dayIndex,
                                  ),
                            })
                          }
                        />
                        {language === 'hi'
                          ? [
                              'रवि',
                              'सोम',
                              'मंगल',
                              'बुध',
                              'गुरु',
                              'शुक्र',
                              'शनि',
                            ][dayIndex]
                          : day}
                      </label>
                    ))}
                  </fieldset>
                  {fieldError(`${activity.id}-days`)}
                </details>
              </fieldset>
            ))}
          </div>
          <div className="dialog-actions">
            <span className="help-text">
              {dirty
                ? t('Unsaved changes', 'बदलाव सहेजे नहीं गए')
                : t('No changes yet', 'अभी कोई बदलाव नहीं')}
            </span>
            <div className="button-row">
              <button
                type="button"
                className="button secondary"
                onClick={requestClose}
              >
                {t('Cancel', 'रद्द करें')}
              </button>
              <button type="submit" className="button primary">
                {t('Save plan', 'योजना सहेजें')}
              </button>
            </div>
          </div>
          {saveError && (
            <p className="field-error" role="alert">
              {saveError}
            </p>
          )}
          {busy && (
            <p role="status">
              {t('Saving complete plan…', 'पूरी योजना सहेजी जा रही है…')}
            </p>
          )}
        </fieldset>
      </form>
    </dialog>
  )
}
