import { useState } from 'react'
import type { Language } from '../types.ts'
import { say } from '../lib/labels.ts'
export default function PrivacyControls({
  language,
  disabled,
  onExport,
  onClear,
  onRecoveryExport,
  journeysEnabled = false,
}: {
  language: Language
  disabled: boolean
  onExport: () => void
  onClear: () => Promise<void>
  onRecoveryExport: () => Promise<void>
  journeysEnabled?: boolean
}) {
  const [confirming, setConfirming] = useState(false),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const t = (en: string, hi: string) => say(language, en, hi)
  return (
    <section className="card privacy-controls" aria-labelledby="privacy-title">
      <h2 id="privacy-title">
        {t('Your data & connected services', 'आपका डेटा और जुड़ी सेवाएं')}
      </h2>
      <dl>
        <div>
          <dt>{t('Kept in this browser', 'इस ब्राउज़र में रखा गया')}</dt>
          <dd>
            {t(
              'Plan, quick activities, decision reasons/evidence, saved coarse places, private feedback, dismissals and language. Up to five coarse public evidence snapshots are stored separately for offline reading. Selected location is saved separately; location permission is requested only when you press the button.',
              'योजना, त्वरित गतिविधि, निर्णय डेटा, गोल सहेजे स्थान, निजी प्रतिक्रिया, हटाए संदेश और भाषा। पांच सार्वजनिक डेटा क्षेत्र ऑफलाइन पढ़ने के लिए अलग रखे जाते हैं। चुना स्थान अलग सहेजा है; अनुमति बटन दबाने पर ही मांगी जाती है।',
            )}
            {journeysEnabled && (
              <>
                {' '}
                {t(
                  'Optional local journeys keep exact positions in a separate browser store. Export journeys from History; the planning backup does not include them.',
                  'वैकल्पिक स्थानीय यात्राओं के सटीक स्थान अलग ब्राउज़र संग्रह में रहते हैं। इतिहास से यात्राएं निर्यात करें; योजना बैकअप में ये शामिल नहीं हैं।',
                )}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{t('Sent for air-data lookup', 'वायु डेटा खोज के लिए भेजा')}</dt>
          <dd>
            {t(
              'Selected coordinates and place go to our API. Provider requests use a rounded area. The forecast and observations come from configured providers, not your own sensor.',
              'चुने निर्देशांक और स्थान हमारे API को जाते हैं। स्रोत अनुरोध गोल किए क्षेत्र से होते हैं। पूर्वानुमान और अवलोकन स्रोतों से आते हैं, आपके सेंसर से नहीं।',
            )}
          </dd>
        </div>
        <div>
          <dt>{t('Optional cloud sharing', 'वैकल्पिक क्लाउड साझाकरण')}</dt>
          <dd>
            {t(
              'Only a supported record you explicitly submit to a signed-in workspace is shared. Local deletion does not delete shared workspace records or server evidence. No purifier or wearable connection is active.',
              'केवल आपके स्पष्ट रूप से लॉग-इन कार्यस्थान में भेजे समर्थित रिकॉर्ड साझा होते हैं। स्थानीय मिटाना साझा रिकॉर्ड या सर्वर डेटा नहीं मिटाता। कोई प्यूरिफायर या पहनने योग्य उपकरण जुड़ा नहीं है।',
            )}
          </dd>
        </div>
      </dl>
      <div className="button-row">
        <button type="button" className="button secondary" onClick={onExport}>
          {t('Export planning backup', 'योजना बैकअप निर्यात')}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onRecoveryExport()
              setMessage(
                t(
                  'Stored recovery copy exported. It may include private names and reasons.',
                  'संग्रह का रिकवरी निर्यात हो गया। इसमें निजी नाम और कारण हो सकते हैं।',
                ),
              )
            } catch (e) {
              setMessage(
                e instanceof Error ? e.message : 'Recovery export failed.',
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          {t('Export stored recovery copy', 'संग्रह की रिकवरी प्रति निर्यात')}
        </button>
        <button
          type="button"
          className="button danger"
          disabled={disabled || busy}
          onClick={() => {
            setConfirming(true)
            setMessage('')
          }}
        >
          {t('Clear local Airday data', 'स्थानीय Airday डेटा मिटाएं')}
        </button>
      </div>
      {confirming && (
        <div className="delete-confirmation">
          <h3>
            {t(
              'Clear local planning and location?',
              'स्थानीय योजना और स्थान मिटाएं?',
            )}
          </h3>
          <p>
            {t(
              'This removes Airday’s plan, local journal, quick activities, favorites, local journeys with exact positions, private feedback, preferences, saved location, offline evidence and legacy/migration recovery copies in this browser origin. Export planning and journeys first. Other websites, server evidence and shared workspace records are unaffected.',
              'यह इस ब्राउज़र मूल की Airday योजना, इतिहास, गतिविधि, सहेजे क्षेत्र, सटीक स्थान वाली स्थानीय यात्राएं, निजी प्रतिक्रिया, प्राथमिकता, स्थान, ऑफलाइन डेटा और पुराने रिकवरी बैकअप मिटाता है। पहले योजना और यात्राएं निर्यात करें। अन्य वेबसाइट, सर्वर डेटा और साझा रिकॉर्ड नहीं मिटते।',
            )}
          </p>
          <label className="field">
            {t('Type CLEAR to confirm', 'पुष्टि के लिए CLEAR लिखें')}
            <input
              value={confirm}
              autoComplete="off"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                setConfirm('')
              }}
            >
              {t('Keep my data', 'मेरा डेटा रखें')}
            </button>
            <button
              type="button"
              className="button danger"
              disabled={disabled || busy || confirm !== 'CLEAR'}
              onClick={async () => {
                setBusy(true)
                setMessage('')
                try {
                  await onClear()
                  setConfirming(false)
                  setConfirm('')
                  setMessage(
                    t(
                      'Local planning and location cleared. Shared and server records were not deleted.',
                      'स्थानीय योजना और स्थान मिट गए। साझा और सर्वर रिकॉर्ड नहीं मिटाए गए।',
                    ),
                  )
                } catch (e) {
                  setMessage(
                    e instanceof Error ? e.message : 'Local deletion failed.',
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('Confirm local deletion', 'स्थानीय मिटाने की पुष्टि')}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p role="status" className="coverage-warning">
          {message}
        </p>
      )}
    </section>
  )
}
