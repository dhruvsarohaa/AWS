import { useRef } from 'react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { AppView } from './useViewState.ts'

gsap.registerPlugin(useGSAP, ScrollTrigger)

export function useAppMotion(view: AppView) {
  const scope = useRef<HTMLDivElement>(null)
  useGSAP(
    () => {
      const media = gsap.matchMedia()
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const panel = scope.current?.querySelector<HTMLElement>(
          `[data-view="${view}"]`,
        )
        if (!panel) return
        gsap.fromTo(
          panel,
          { y: 10, opacity: 0.65 },
          {
            y: 0,
            opacity: 1,
            duration: 0.32,
            ease: 'power3.out',
            clearProps: 'transform,opacity',
          },
        )
        // Only lower supporting sections enter on scroll. The primary task is ready immediately.
        panel
          .querySelectorAll<HTMLElement>(
            '.guidance-card, .history-trends, .help-panel',
          )
          .forEach((item) => {
            gsap.fromTo(
              item,
              { y: 12 },
              {
                y: 0,
                duration: 0.4,
                ease: 'power3.out',
                clearProps: 'transform',
                scrollTrigger: { trigger: item, start: 'top 94%', once: true },
              },
            )
          })
        const animatedDialogs = new Set<HTMLDialogElement>()
        const observer = new MutationObserver((records) => {
          records.forEach(({ target, attributeName }) => {
            if (
              attributeName !== 'open' ||
              !(target instanceof HTMLDialogElement)
            )
              return
            const dialog = target
            animatedDialogs.add(dialog)
            gsap.killTweensOf(dialog)
            if (dialog.open)
              gsap.fromTo(
                dialog,
                { y: 14, scale: 0.985, opacity: 0.5 },
                {
                  y: 0,
                  scale: 1,
                  opacity: 1,
                  duration: 0.26,
                  ease: 'power3.out',
                  clearProps: 'transform,opacity',
                },
              )
          })
        })
        if (scope.current)
          observer.observe(scope.current, {
            attributes: true,
            subtree: true,
            attributeFilter: ['open'],
          })
        return () => {
          observer.disconnect()
          animatedDialogs.forEach((dialog) => {
            gsap.killTweensOf(dialog)
            gsap.set(dialog, { clearProps: 'transform,opacity' })
          })
        }
      })
      return () => media.revert()
    },
    { dependencies: [view], scope, revertOnUpdate: true },
  )
  return scope
}
