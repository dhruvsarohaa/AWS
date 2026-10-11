import type { AppView } from '../hooks/useViewState.ts'
import type { Language } from '../types.ts'
import { say } from '../lib/labels.ts'
import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
const items: [AppView, string, string, string][] = [
  ['today', 'Today', 'आज', 'M3 11 12 3l9 8v10h-6v-7H9v7H3Z'],
  ['plan', 'Plan', 'योजना', 'M6 4h12v17H6ZM9 2v4m6-4v4M9 10h6m-6 4h6m-6 4h4'],
  ['evidence', 'Evidence', 'डेटा', 'M4 3v17h17M8 15l4-6 4 3 4-7'],
  ['history', 'History', 'इतिहास', 'M4 7a9 9 0 1 1-1 9M3 3v5h5m4-1v6l4 2'],
  [
    'settings',
    'Settings',
    'सेटिंग्स',
    'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M9 15v6',
  ],
]
export default function AppNavigation({
  view,
  language,
  onNavigate,
  disabled,
}: {
  view: AppView
  language: Language
  disabled: boolean
  onNavigate: (view: AppView) => void
}) {
  const navigation = useRef<HTMLElement>(null)
  const indicator = useRef<HTMLSpanElement>(null)
  const refreshIndicator = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    const nav = navigation.current,
      pill = indicator.current
    if (!nav || !pill) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const current = { x: 0, y: 0, width: 0, height: 0 }
    const target = { ...current },
      velocity = { x: 0, y: 0, width: 0, height: 0 }
    const axes = ['x', 'y', 'width', 'height'] as const
    let initialized = false,
      ticking = false
    const paint = () => gsap.set(pill, current)
    const tick = (_time: number, elapsed: number) => {
      const dt = Math.min(elapsed / 1000, 1 / 30)
      let moving = false
      for (const key of axes) {
        // Retarget from the current presentation and velocity, with critical damping.
        velocity[key] +=
          ((target[key] - current[key]) * 420 - velocity[key] * 41) * dt
        current[key] += velocity[key] * dt
        if (
          Math.abs(target[key] - current[key]) > 0.05 ||
          Math.abs(velocity[key]) > 0.1
        )
          moving = true
      }
      paint()
      if (!moving) {
        Object.assign(current, target)
        paint()
        gsap.ticker.remove(tick)
        ticking = false
      }
    }
    const update = () => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]')
      if (!active) return
      Object.assign(target, {
        x: active.offsetLeft,
        y: active.offsetTop,
        width: active.offsetWidth,
        height: active.offsetHeight,
      })
      if (!initialized || reduced.matches) {
        Object.assign(current, target)
        for (const key of axes) velocity[key] = 0
        paint()
        initialized = true
        gsap.ticker.remove(tick)
        ticking = false
      } else if (!ticking) {
        gsap.ticker.add(tick)
        ticking = true
      }
      nav.dataset.motion = 'ready'
    }
    refreshIndicator.current = update
    const observer = new ResizeObserver(update)
    observer.observe(nav)
    nav.querySelectorAll('a').forEach((a) => observer.observe(a))
    reduced.addEventListener('change', update)
    update()
    return () => {
      observer.disconnect()
      reduced.removeEventListener('change', update)
      gsap.ticker.remove(tick)
      refreshIndicator.current = null
    }
  }, [])
  useLayoutEffect(() => {
    refreshIndicator.current?.()
  }, [view, language])
  return (
    <nav
      ref={navigation}
      className="app-navigation"
      aria-label={say(language, 'Main navigation', 'मुख्य नेविगेशन')}
    >
      <span
        ref={indicator}
        className="navigation-indicator"
        aria-hidden="true"
      />
      {items.map(([id, en, hi, path]) => (
        <a
          key={id}
          className={view === id ? 'current' : ''}
          href={`#${id}`}
          aria-current={view === id ? 'page' : undefined}
          aria-disabled={disabled || undefined}
          onClick={(e) => {
            if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
              e.preventDefault()
              if (!disabled) onNavigate(id)
            }
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d={path} />
          </svg>
          <span>{say(language, en, hi)}</span>
        </a>
      ))}
      <p className="navigation-note">
        {say(
          language,
          'Your plan, on your device.',
          'आपकी योजना, आपके डिवाइस पर।',
        )}
        <span>
          {say(
            language,
            'Local records stay in this browser.',
            'स्थानीय रिकॉर्ड इसी ब्राउज़र में रहते हैं।',
          )}
        </span>
      </p>
    </nav>
  )
}
