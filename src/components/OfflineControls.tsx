import { useEffect, useState } from 'react'
import type { Language } from '../types.ts'
import { clearOfflineEvidence } from '../lib/offlineEvidence.ts'
import { say } from '../lib/labels.ts'
type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}
export default function OfflineControls({
  language,
  disabled,
}: {
  language: Language
  disabled: boolean
}) {
  const [install, setInstall] = useState<InstallEvent | null>(null),
    [waiting, setWaiting] = useState(false),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    t = (en: string, hi: string) => say(language, en, hi)
  useEffect(() => {
    let mounted = true
    const prompt = (e: Event) => {
        e.preventDefault()
        setInstall(e as InstallEvent)
      },
      installed = () => setInstall(null),
      update = () => setWaiting(true),
      issue = () =>
        setMessage(
          say(
            language,
            'Offline app shell could not install. Online use remains available.',
            'ऑफलाइन ऐप इंस्टॉल नहीं हुआ। ऑनलाइन उपयोग उपलब्ध है।',
          ),
        )
    window.addEventListener('beforeinstallprompt', prompt)
    window.addEventListener('appinstalled', installed)
    window.addEventListener('airday-update-ready', update)
    window.addEventListener('airday-offline-error', issue)
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker
        .getRegistration()
        .then((r) => {
          if (mounted && r?.waiting) setWaiting(true)
        })
        .catch(() => {
          if (mounted) issue()
        })
    return () => {
      mounted = false
      window.removeEventListener('beforeinstallprompt', prompt)
      window.removeEventListener('appinstalled', installed)
      window.removeEventListener('airday-update-ready', update)
      window.removeEventListener('airday-offline-error', issue)
    }
  }, [language])
  return (
    <section id="offline-tools" tabIndex={-1} className="card offline-controls">
      <h2>{t('Install & offline reading', 'इंस्टॉल और ऑफलाइन पढ़ना')}</h2>
      <p className="help-text">
        {t(
          'The production build can install on supported HTTPS browsers. First visit online to save the app shell. Up to five recently viewed coarse-area public evidence snapshots are kept separately, with original retrieval times. Offline mode is read-only and never runs alerts or refreshes. API, private workspace responses, auth and map tiles are excluded from service-worker caches.',
          'उत्पादन संस्करण समर्थित HTTPS ब्राउज़र में इंस्टॉल होता है। पहली बार ऑनलाइन खोलें। पांच हाल के गोल क्षेत्रों का सार्वजनिक डेटा मूल समय के साथ अलग रखा जाता है। ऑफलाइन केवल पढ़ने के लिए है; चेतावनी या रिफ्रेश नहीं। निजी API, लॉग-इन और नक्शे संग्रह में नहीं।',
        )}
      </p>
      <div className="button-row">
        {install && (
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await install.prompt()
                await install.userChoice
                setInstall(null)
              } catch {
                setInstall(null)
                setMessage(
                  t(
                    'Installation could not start. Use your browser’s install option where supported.',
                    'इंस्टॉल शुरू नहीं हुआ। समर्थित ब्राउज़र का इंस्टॉल विकल्प उपयोग करें।',
                  ),
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('Install Airday', 'Airday इंस्टॉल करें')}
          </button>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={busy || disabled}
          onClick={async () => {
            setBusy(true)
            try {
              await clearOfflineEvidence()
              setMessage(
                t(
                  'Cached public evidence cleared.',
                  'संग्रहीत सार्वजनिक डेटा हटाया।',
                ),
              )
            } catch {
              setMessage(
                t(
                  'Cached evidence could not clear. Existing bytes were preserved; try again.',
                  'संग्रहीत डेटा नहीं हटाया गया। पुराने डेटा सुरक्षित हैं; फिर प्रयास करें।',
                ),
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          {t('Clear offline evidence', 'ऑफलाइन डेटा हटाएं')}
        </button>
      </div>
      {!install && (
        <p>
          {t(
            'If no install button appears, use your browser’s “Install app” or “Add to Home Screen” option where supported. The Vite development server does not register an offline worker.',
            'इंस्टॉल बटन न दिखे तो समर्थित ब्राउज़र का “ऐप इंस्टॉल” या “होम स्क्रीन” विकल्प उपयोग करें। विकास सर्वर ऑफलाइन वर्कर नहीं बनाता।',
          )}
        </p>
      )}
      {waiting && (
        <p className="preview-note">
          {t(
            'An updated app is ready. Finish or export open drafts, then close all Airday tabs and reopen. Updates do not force a reload or replace your drafts.',
            'नया संस्करण तैयार है। खुले ड्राफ्ट सहेजें/निर्यात करें, फिर सभी Airday टैब बंद और खोलें। अपडेट खुद पृष्ठ या ड्राफ्ट नहीं बदलता।',
          )}
        </p>
      )}
      <p role="status">{message}</p>
    </section>
  )
}
