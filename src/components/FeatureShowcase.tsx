import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { gsap } from 'gsap'
import type { AppView } from '../hooks/useViewState.ts'
import type { ServiceConfig } from '../hooks/useServiceStatus.ts'
import type { Language } from '../types.ts'
import { say } from '../lib/labels.ts'

type Gate = keyof ServiceConfig['capabilities'] | 'pilot'
type Feature = {
  id: string
  name: string
  hi: string
  view: AppView
  target: string
  kind: number
  gate?: Gate
}
const features: Feature[] = [
  {
    id: 'F01',
    name: 'Find a better time',
    hi: 'बेहतर समय खोजें',
    view: 'today',
    target: 'quick-title',
    kind: 0,
  },
  {
    id: 'F02',
    name: 'Activities & templates',
    hi: 'गतिविधियाँ और नमूने',
    view: 'plan',
    target: 'view-title-plan',
    kind: 1,
  },
  {
    id: 'F03',
    name: 'Nearby stations & map',
    hi: 'नज़दीकी स्टेशन और नक्शा',
    view: 'evidence',
    target: 'station-list-title',
    kind: 4,
  },
  {
    id: 'F04',
    name: 'Saved places',
    hi: 'सहेजे स्थान',
    view: 'settings',
    target: 'saved-places-title',
    kind: 4,
  },
  {
    id: 'F05',
    name: 'In-app review alerts',
    hi: 'ऐप में समीक्षा संदेश',
    view: 'today',
    target: 'alerts-title',
    kind: 1,
  },
  {
    id: 'F06',
    name: 'Email alerts & daily brief',
    hi: 'ईमेल और दैनिक सार',
    view: 'settings',
    target: 'shared-tools',
    kind: 1,
    gate: 'reviewEmail',
  },
  {
    id: 'F07',
    name: 'Historical evidence',
    hi: 'पुराना वायु डेटा',
    view: 'history',
    target: 'evidence-trends',
    kind: 3,
  },
  {
    id: 'F08',
    name: 'CSV & printable reports',
    hi: 'CSV और प्रिंट रिपोर्ट',
    view: 'history',
    target: 'history-title',
    kind: 3,
  },
  {
    id: 'F09',
    name: 'Daily & weekly recap',
    hi: 'दैनिक और साप्ताहिक सार',
    view: 'history',
    target: 'personal-progress',
    kind: 3,
  },
  {
    id: 'F10',
    name: 'Concentration × time',
    hi: 'सांद्रता × समय',
    view: 'today',
    target: 'outdoor-title',
    kind: 2,
  },
  {
    id: 'F11',
    name: 'Six pollutant views',
    hi: 'छह प्रदूषकों का डेटा',
    view: 'evidence',
    target: 'pollutant-tools',
    kind: 2,
  },
  {
    id: 'F12',
    name: 'Compare time periods',
    hi: 'अवधियों की तुलना',
    view: 'evidence',
    target: 'pollutant-tools',
    kind: 2,
  },
  {
    id: 'F13',
    name: 'Public evidence display',
    hi: 'सार्वजनिक डेटा डिस्प्ले',
    view: 'settings',
    target: 'public-tools',
    kind: 2,
    gate: 'publicEvidence',
  },
  {
    id: 'F14',
    name: 'Site & area groups',
    hi: 'स्थान और क्षेत्र समूह',
    view: 'settings',
    target: 'area-groups',
    kind: 4,
    gate: 'localGroups',
  },
  {
    id: 'F15',
    name: 'Shared responsibilities',
    hi: 'साझा ज़िम्मेदारियाँ',
    view: 'settings',
    target: 'shared-tools',
    kind: 1,
    gate: 'sharedWorkspaces',
  },
  {
    id: 'F16',
    name: 'Source status & freshness',
    hi: 'स्रोत और ताज़गी',
    view: 'evidence',
    target: 'view-title-evidence',
    kind: 2,
  },
  {
    id: 'F17',
    name: 'English / Hindi guidance',
    hi: 'अंग्रेज़ी / हिन्दी मार्गदर्शन',
    view: 'today',
    target: 'guidance-title',
    kind: 0,
  },
  {
    id: 'F18',
    name: 'Explanation assistant',
    hi: 'व्याख्या सहायक',
    view: 'settings',
    target: 'service-status',
    kind: 0,
    gate: 'pilot',
  },
  {
    id: 'F19',
    name: 'Practical feedback',
    hi: 'व्यावहारिक प्रतिक्रिया',
    view: 'today',
    target: 'outdoor-title',
    kind: 1,
  },
  {
    id: 'F20',
    name: 'Private progress',
    hi: 'निजी प्रगति',
    view: 'history',
    target: 'personal-progress',
    kind: 3,
  },
  {
    id: 'F21',
    name: 'Install & offline reading',
    hi: 'इंस्टॉल और ऑफलाइन पढ़ें',
    view: 'settings',
    target: 'offline-tools',
    kind: 3,
  },
  {
    id: 'F22',
    name: 'Public API & widget',
    hi: 'सार्वजनिक API और विजेट',
    view: 'settings',
    target: 'public-tools',
    kind: 2,
    gate: 'publicEvidence',
  },
  {
    id: 'F23',
    name: 'Weather context',
    hi: 'मौसम संदर्भ',
    view: 'evidence',
    target: 'weather-context',
    kind: 0,
    gate: 'weather',
  },
  {
    id: 'F24',
    name: 'Satellite-fire context',
    hi: 'उपग्रह आग संदर्भ',
    view: 'evidence',
    target: 'fire-context',
    kind: 4,
    gate: 'fires',
  },
  {
    id: 'F25',
    name: 'Route comparisons',
    hi: 'मार्ग तुलना',
    view: 'settings',
    target: 'service-status',
    kind: 4,
    gate: 'pilot',
  },
  {
    id: 'F26',
    name: 'Local journeys & GPX',
    hi: 'स्थानीय यात्रा और GPX',
    view: 'history',
    target: 'r4-journeys-title',
    kind: 4,
    gate: 'r4',
  },
  {
    id: 'F27',
    name: 'Wearable connections',
    hi: 'पहनने वाले उपकरण',
    view: 'settings',
    target: 'service-status',
    kind: 3,
    gate: 'pilot',
  },
  {
    id: 'F28',
    name: 'Indoor / outdoor devices',
    hi: 'अंदर / बाहर के उपकरण',
    view: 'settings',
    target: 'r5-devices-title',
    kind: 2,
    gate: 'r5',
  },
  {
    id: 'F29',
    name: 'Purifier controls',
    hi: 'प्यूरीफायर नियंत्रण',
    view: 'settings',
    target: 'r5-devices-title',
    kind: 2,
    gate: 'r5',
  },
  {
    id: 'F30',
    name: 'Pollen context',
    hi: 'पराग संदर्भ',
    view: 'settings',
    target: 'service-status',
    kind: 0,
    gate: 'pilot',
  },
  {
    id: 'F31',
    name: 'Fine-scale air maps',
    hi: 'सूक्ष्म वायु नक्शे',
    view: 'settings',
    target: 'service-status',
    kind: 4,
    gate: 'pilot',
  },
  {
    id: 'F32',
    name: 'Site ventilation controls',
    hi: 'स्थल वेंटिलेशन नियंत्रण',
    view: 'settings',
    target: 'r5-devices-title',
    kind: 2,
    gate: 'r5',
  },
]

function FeatureArt({ kind }: { kind: number }) {
  return (
    <svg
      className="feature-art"
      viewBox="0 0 180 160"
      fill="none"
      aria-hidden="true"
    >
      {kind === 0 && (
        <>
          <circle
            cx="90"
            cy="82"
            r="55"
            fill="var(--art-paper)"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M90 40v10m42 32h-10M90 124v-10M48 82h10M90 58v27l22 14"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <circle cx="90" cy="82" r="5" fill="currentColor" />
          <path
            d="m127 27 8-10m8 27 12-4M37 34l-8-8"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === 1 && (
        <>
          <rect
            x="31"
            y="29"
            width="119"
            height="116"
            rx="17"
            fill="var(--art-paper)"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M32 65h116M62 20v23m56-23v23"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="m63 100 16 15 35-36"
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="145" cy="127" r="19" fill="var(--art-accent)" />
          <path
            d="M145 117v20m-10-10h20"
            stroke="currentColor"
            strokeWidth="3"
          />
        </>
      )}
      {kind === 2 && (
        <>
          <rect
            x="18"
            y="35"
            width="145"
            height="98"
            rx="18"
            fill="var(--art-paper)"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M35 64h111M35 87h111M35 111h111"
            stroke="currentColor"
            opacity=".15"
          />
          <path
            d="m35 105 22-17 20 10 24-39 21 20 25-9"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx="101"
            cy="59"
            r="7"
            fill="var(--art-accent)"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M77 145h28"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === 3 && (
        <>
          <rect
            x="44"
            y="19"
            width="100"
            height="125"
            rx="13"
            fill="var(--art-accent)"
            transform="rotate(8 94 81)"
            stroke="currentColor"
            strokeWidth="2"
          />
          <rect
            x="30"
            y="28"
            width="106"
            height="120"
            rx="13"
            fill="var(--art-paper)"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M49 51h67M49 65h43"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M50 127v-25m24 25V92m24 35V79"
            stroke="currentColor"
            strokeWidth="12"
          />
          <circle
            cx="134"
            cy="119"
            r="21"
            fill="var(--art-accent)"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="m124 119 7 7 13-15"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === 4 && (
        <>
          <path
            d="m20 54 44-14 48 14 48-14v98l-47 13-48-13-45 14Z"
            fill="var(--art-paper)"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d="M65 43v94m47-82v93M21 99l44-16 47 20 46-22"
            stroke="currentColor"
            strokeWidth="2"
            opacity=".25"
          />
          <path
            d="M119 49c0 21-28 47-28 47S63 70 63 49a28 28 0 1 1 56 0Z"
            fill="var(--art-accent)"
            stroke="currentColor"
            strokeWidth="3"
          />
          <circle
            cx="91"
            cy="48"
            r="10"
            fill="var(--art-paper)"
            stroke="currentColor"
            strokeWidth="3"
          />
        </>
      )}
    </svg>
  )
}

type TrailPoint = {
  id: number
  x: number
  y: number
  rotation: number
  item: number
}
function TrailTile({
  point,
  children,
  onDone,
}: {
  point: TrailPoint
  children: ReactNode
  onDone: (id: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const animation = gsap
      .timeline({ onComplete: () => onDone(point.id) })
      .fromTo(
        ref.current,
        { opacity: 0, scale: 0.55, rotation: point.rotation * 1.4 },
        {
          opacity: 1,
          scale: 1,
          rotation: point.rotation,
          duration: 0.3,
          ease: 'power3.out',
        },
      )
      .to(ref.current, {
        opacity: 0,
        scale: 0.8,
        y: -20,
        duration: 0.3,
        delay: 0.6,
        ease: 'power2.in',
      })
    return () => {
      animation.kill()
    }
  }, [point, onDone])
  return (
    <div
      ref={ref}
      className="cursor-feature"
      style={{ left: point.x, top: point.y }}
      aria-hidden="true"
    >
      {children}
    </div>
  )
}

export default function FeatureShowcase({
  language,
  disabled,
  capabilities,
  onOpen,
  onFind,
}: {
  language: Language
  disabled: boolean
  capabilities: ServiceConfig['capabilities'] | null
  onOpen: (view: AppView, target: string) => void
  onFind: () => void
}) {
  const t = (en: string, hi: string) => say(language, en, hi)
  const [trail, setTrail] = useState<TrailPoint[]>([])
  const sequence = useRef(0),
    last = useRef<{ x: number; y: number } | null>(null)
  const motionAllowed = useRef(false)
  const clear = useMemo(
    () => (id: number) =>
      setTrail((current) => current.filter((point) => point.id !== id)),
    [],
  )
  useEffect(() => {
    const media = window.matchMedia(
      '(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)',
    )
    const update = () => {
      motionAllowed.current = media.matches
      if (!media.matches) {
        setTrail([])
        last.current = null
      }
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const available = (feature: Feature) =>
    !feature.gate ||
    (feature.gate === 'r4'
      ? capabilities?.r4?.localJourneys === true
      : feature.gate === 'r5'
        ? capabilities?.r5?.indoorDevices === true
        : feature.gate === 'pilot'
          ? false
          : capabilities?.[feature.gate] === true)
  const open = (feature: Feature) =>
    available(feature)
      ? onOpen(feature.view, feature.target)
      : onOpen('settings', 'service-status')
  const groups = [
    features[0],
    features[1],
    features[10],
    features[7],
    features[3],
  ]
  const names = [
    ['Find your\ntime.', 'अपना समय\nखोजें।'],
    ['Make a\nplan.', 'योजना\nबनाएं।'],
    ['Know the\nair.', 'हवा को\nजानें।'],
    ['Keep your\nstory.', 'अपने निर्णय\nसहेजें।'],
    ['Places to\nreturn to.', 'अपने स्थान\nपास रखें।'],
  ]
  return (
    <section
      className="feature-showcase"
      aria-labelledby="view-title-today"
      onPointerLeave={() => {
        setTrail([])
        last.current = null
      }}
      onPointerMove={(event) => {
        if (
          !motionAllowed.current ||
          disabled ||
          event.pointerType !== 'mouse' ||
          (event.target as Element).closest('button,a,input,select,summary')
        )
          return
        const rect = event.currentTarget.getBoundingClientRect(),
          x = event.clientX - rect.left,
          y = event.clientY - rect.top
        if (
          last.current &&
          Math.hypot(x - last.current.x, y - last.current.y) < 85
        )
          return
        last.current = { x, y }
        const id = sequence.current++
        setTrail((current) =>
          [
            ...current,
            {
              id,
              x,
              y,
              rotation: ((id * 13) % 31) - 15,
              item: id % features.length,
            },
          ].slice(-6),
        )
      }}
    >
      <div className="showcase-copy">
        <p className="showcase-eyebrow">
          {t(
            'A little more clarity. A little more outside.',
            'थोड़ी और स्पष्टता। थोड़ा और बाहर का समय।',
          )}
        </p>
        <h1 id="view-title-today" tabIndex={-1}>
          {t('Make room for outside.', 'बाहर के समय के लिए जगह बनाएं।')}
        </h1>
        <p className="showcase-intro">
          {t(
            'Your plans, the air around you, and a clearer way to choose. ',
            'आपकी योजनाएँ, आसपास की हवा और समय चुनने का स्पष्ट तरीका। ',
          )}
          <span>{t('One day at a time.', 'एक दिन, एक कदम।')}</span>
        </p>
        <div className="showcase-actions">
          <button
            className="button primary"
            disabled={disabled}
            onClick={onFind}
          >
            {t('Find my time', 'अपना समय खोजें')}{' '}
            <span aria-hidden="true">↗</span>
          </button>
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => onOpen('evidence', 'view-title-evidence')}
          >
            {t('Explore the evidence', 'वायु डेटा देखें')}{' '}
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
      <div
        className="feature-fan"
        aria-label={t('Explore Airday', 'Airday के साधन')}
      >
        {groups.map((feature, index) => (
          <button
            type="button"
            className={`feature-poster tone-${index}`}
            key={feature.id}
            disabled={disabled}
            onClick={() => open(feature)}
            style={
              { '--tilt': `${[-8, 5, -3, 7, -6][index]}deg` } as CSSProperties
            }
          >
            <span className="poster-top">
              airday. <span aria-hidden="true">↗</span>
            </span>
            <FeatureArt kind={feature.kind} />
            <strong>{t(...(names[index] as [string, string]))}</strong>
            <span className="poster-caption">
              {t(feature.name, feature.hi)}
            </span>
          </button>
        ))}
      </div>
      <details className="feature-directory">
        <summary>
          {t('Explore every feature', 'सभी सुविधाएँ देखें')}{' '}
          <span>
            {features.length} <span aria-hidden="true">+</span>
          </span>
        </summary>
        <p>
          {t(
            'Open a tool to get started. Shared services and pilot integrations show their current setup requirements.',
            'शुरू करने के लिए साधन खोलें। साझा सेवाओं और पायलट कनेक्शन के लिए वर्तमान सेटअप आवश्यकताएँ दिखाई जाती हैं।',
          )}
        </p>
        <div className="feature-index">
          {features.map((feature) => (
            <button
              type="button"
              key={feature.id}
              disabled={disabled}
              onClick={() => open(feature)}
            >
              <span className="feature-number">{feature.id.slice(1)}</span>
              <span>
                {t(feature.name, feature.hi)}
                {feature.gate && !available(feature) && (
                  <small>{t('View availability', 'उपलब्धता देखें')}</small>
                )}
              </span>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      </details>
      <div className="feature-trail" aria-hidden="true">
        {trail.map((point) => {
          const feature = features[point.item]
          return (
            <TrailTile key={point.id} point={point} onDone={clear}>
              <div className={`trail-poster tone-${feature.kind}`}>
                <span>airday. / {feature.id}</span>
                <FeatureArt kind={feature.kind} />
                <strong>{t(feature.name, feature.hi)}</strong>
                {feature.gate && !available(feature) && (
                  <small>{t('Setup required', 'सेटअप आवश्यक')}</small>
                )}
              </div>
            </TrailTile>
          )
        })}
      </div>
    </section>
  )
}
