import type { AppView } from '../hooks/useViewState.ts'
import type { Language } from '../types.ts'
import { say } from '../lib/labels.ts'

const tools: [AppView, string, string, string, string][] = [
  [
    'plan',
    'view-title-plan',
    'Activities & templates',
    'गतिविधियाँ और नमूने',
    '01',
  ],
  [
    'evidence',
    'forecast-title',
    'Hourly air forecast',
    'प्रति घंटा वायु पूर्वानुमान',
    '02',
  ],
  ['evidence', 'station-list-title', 'Stations & map', 'स्टेशन और नक्शा', '03'],
  [
    'evidence',
    'pollutant-tools',
    'Pollutants & periods',
    'प्रदूषक और अवधि',
    '04',
  ],
  [
    'history',
    'history-title',
    'Decisions & reports',
    'निर्णय और रिपोर्ट',
    '05',
  ],
  ['history', 'evidence-trends', 'Evidence trends', 'डेटा का इतिहास', '06'],
  ['history', 'personal-progress', 'Private progress', 'निजी प्रगति', '07'],
  ['settings', 'saved-places', 'Saved places', 'सहेजे स्थान', '08'],
  ['settings', 'offline-tools', 'Install & offline', 'इंस्टॉल और ऑफलाइन', '09'],
  ['settings', 'settings-title', 'Data & recovery', 'डेटा और रिकवरी', '10'],
  ['settings', 'service-status', 'Connections', 'कनेक्शन', '11'],
  ['settings', 'help-title', 'Help & methods', 'सहायता और तरीके', '12'],
]
export default function ToolDrawer({
  language,
  disabled,
  onOpen,
}: {
  language: Language
  disabled: boolean
  onOpen: (view: AppView, target: string) => void
}) {
  return (
    <details className="card tool-drawer">
      <summary>
        <svg aria-hidden="true" className="tool-disclosure" viewBox="0 0 24 24">
          <path d="m8 5 7 7-7 7" />
        </svg>
        {say(language, 'Explore your tools', 'अपने साधन देखें')}
        <span>
          {say(
            language,
            'Planning · evidence · your data',
            'योजना · डेटा · आपका संग्रह',
          )}
        </span>
      </summary>
      <div className="tool-grid">
        {tools.map(([view, target, en, hi]) => (
          <button
            key={target}
            type="button"
            disabled={disabled}
            className="tool-link"
            onClick={() => onOpen(view, target)}
          >
            {say(language, en, hi)}
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 12h14m-5-5 5 5-5 5" />
            </svg>
          </button>
        ))}
      </div>
    </details>
  )
}
