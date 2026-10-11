import { useRef, useState } from 'react'
import type { Language, SuggestionFeedback as Feedback } from '../types.ts'
import { say } from '../lib/labels.ts'
import { appendSuggestionFeedback } from '../lib/suggestion-feedback.ts'
export default function SuggestionFeedback({
  ...props
}: Parameters<typeof SuggestionFeedbackForm>[0]) {
  return (
    <SuggestionFeedbackForm
      key={JSON.stringify([
        props.assessmentId,
        props.decisionId,
        props.locationKey,
        props.date,
        props.activity,
      ])}
      {...props}
    />
  )
}
function SuggestionFeedbackForm({
  assessmentId,
  decisionId,
  locationKey,
  date,
  activity,
  feedback,
  disabled,
  language,
  onSave,
}: {
  assessmentId: string
  decisionId?: string
  locationKey: string
  date: string
  activity: string
  feedback: Feedback[]
  disabled: boolean
  language: Language
  onSave: (f: Feedback) => Promise<'saved' | 'session' | 'conflict'>
}) {
  const [useful, setUseful] = useState(true),
    [reason, setReason] = useState<Feedback['reason']>('clear'),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const t = (en: string, hi: string) => say(language, en, hi),
    existing = feedback.find(
      (f) =>
        f.assessmentId === assessmentId &&
        f.locationKey === locationKey &&
        f.date === date &&
        f.activity === activity &&
        f.decisionId === decisionId,
    )
  const saving = useRef(false)
  const reasons: Record<Feedback['reason'], string> = {
    timing: t('Timing is impractical', 'समय अव्यावहारिक'),
    indoor_option: t('Indoor option unavailable', 'अंदर विकल्प नहीं'),
    data: t('Data unclear / missing', 'डेटा अस्पष्ट / नहीं'),
    clear: t('Clear and practical', 'स्पष्ट और व्यावहारिक'),
    other: t('Other', 'अन्य'),
  }
  return (
    <details className="suggestion-feedback">
      <summary>
        {t('Was this review useful?', 'क्या यह समीक्षा उपयोगी थी?')}
      </summary>
      <p className="help-text">
        {t(
          'Private feedback linked to this dated assessment. Stored locally; not uploaded. Do not include names or health details.',
          'इस आकलन से जुड़ी निजी प्रतिक्रिया। केवल स्थानीय संग्रह; अपलोड नहीं। नाम या स्वास्थ्य जानकारी न दें।',
        )}
      </p>
      {existing ? (
        <p>
          {existing.useful
            ? t('Marked useful', 'उपयोगी बताया')
            : t('Marked not useful', 'अनुपयोगी बताया')}{' '}
          · {reasons[existing.reason]} · {existing.note}
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (saving.current || busy || disabled || feedback.length >= 200)
              return
            saving.current = true
            setBusy(true)
            try {
              const entry: Feedback = {
                id: crypto.randomUUID(),
                assessmentId,
                decisionId,
                locationKey,
                date,
                activity,
                at: new Date().toISOString(),
                useful,
                reason,
                note: note.trim(),
              }
              appendSuggestionFeedback(feedback, entry)
              const result = await onSave(entry)
              setMessage(
                result === 'saved'
                  ? t('Feedback saved.', 'प्रतिक्रिया सहेजी गई।')
                  : result === 'session'
                    ? t(
                        'Feedback kept for this session only. Export before leaving.',
                        'प्रतिक्रिया केवल इस सत्र में। जाने से पहले निर्यात करें।',
                      )
                    : t(
                        'Not saved. Resolve the storage conflict.',
                        'नहीं सहेजा गया। संग्रह समस्या हल करें।',
                      ),
              )
            } catch {
              setMessage(
                t('Feedback could not save.', 'प्रतिक्रिया नहीं सहेजी गई।'),
              )
            } finally {
              saving.current = false
              setBusy(false)
            }
          }}
        >
          <div className="r2-form-row">
            <label>
              {t('Usefulness', 'उपयोगिता')}
              <select
                value={String(useful)}
                disabled={busy || disabled}
                onChange={(e) => setUseful(e.target.value === 'true')}
              >
                <option value="true">{t('Useful', 'उपयोगी')}</option>
                <option value="false">{t('Not useful', 'अनुपयोगी')}</option>
              </select>
            </label>
            <label>
              {t('Reason', 'कारण')}
              <select
                value={reason}
                disabled={busy || disabled}
                onChange={(e) =>
                  setReason(e.target.value as Feedback['reason'])
                }
              >
                {Object.entries(reasons).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {t(
              'Optional practical note (300 characters)',
              'वैकल्पिक टिप्पणी (300 अक्षर)',
            )}
            <textarea
              maxLength={300}
              value={note}
              disabled={busy || disabled}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            className="button secondary"
            type="submit"
            disabled={busy || disabled || feedback.length >= 200}
          >
            {t('Save once for this assessment', 'इस आकलन के लिए एक बार सहेजें')}
          </button>
          {feedback.length >= 200 && (
            <p>
              {t(
                'Feedback limit reached. Export and clear feedback in History first; nothing was dropped.',
                'प्रतिक्रिया सीमा पूरी। पहले इतिहास से निर्यात और हटाएं; कोई रिकॉर्ड नहीं हटाया गया।',
              )}
            </p>
          )}
        </form>
      )}
      <p role="status">{message}</p>
    </details>
  )
}
