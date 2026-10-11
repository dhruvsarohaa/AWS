import type { Language } from '../types.ts'
import { say } from '../lib/labels.ts'

const sections = [
  [
    'saved-places-title',
    'Places',
    'स्थान',
    'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0ZM9.5 10a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0',
  ],
  [
    'settings-title',
    'Preferences & data',
    'सेटिंग्स और संग्रह',
    'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M9 15v6',
  ],
  [
    'service-status-title',
    'Connections',
    'कनेक्शन',
    'M8 5v6m8-6v6M5 11h14v2a7 7 0 0 1-14 0ZM12 20v2',
  ],
  [
    'help-title',
    'Help',
    'सहायता',
    'M9 9a3 3 0 1 1 4 2.8c-.8.4-1 1-1 2.2M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  ],
] as const

export default function SettingsDirectory({
  language,
}: {
  language: Language
}) {
  return (
    <nav
      className="settings-directory"
      aria-label={say(language, 'Settings sections', 'सेटिंग्स अनुभाग')}
    >
      {sections.map(([id, en, hi, path]) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            const target = document.getElementById(id)
            target?.focus({ preventScroll: true })
            target?.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                .matches
                ? 'instant'
                : 'smooth',
              block: 'start',
            })
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d={path} />
          </svg>
          {say(language, en, hi)}
          <span aria-hidden="true">↗</span>
        </button>
      ))}
    </nav>
  )
}
