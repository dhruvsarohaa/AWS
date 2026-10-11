---
name: Airday
description: A warm, expressive outdoor planner with frosted glass surfaces.
colors:
  canvas: "#fcfaf8"
  paper: "#fcfaf8"
  sand: "#f6eee2"
  ink: "#231f20"
  muted: "#716860"
  line: "#ddd2c5"
  cocoa: "#3d2f24"
  teal: "#1d7f88"
  sky: "#2f95ea"
  coral: "#fe6e5d"
  leaf: "#99cd60"
  glass: "rgb(252 250 248 / 72%)"
  card-glass: "rgb(255 255 255 / 48%)"
typography:
  display:
    fontFamily: "'Archivo Black', 'Nirmala UI', sans-serif"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "-0.055em"
  body:
    fontFamily: "'Manrope', 'Nirmala UI', system-ui, sans-serif"
    fontSize: "16px"
    lineHeight: 1.65
rounded:
  control: "999px"
  input: "12px"
  card: "28px"
spacing:
  compact: "8px"
  field: "16px"
  group: "24px"
  panel: "32px"
  section: "72px"
---

# Airday design system

Current direction, 11 October 2026. Supersedes the earlier field-journal and cool-blue explorations.

## Concept

Warm, expressive editorial design inspired by the structure and measured styles of pepiteboisson.ch, adapted to Airday's planning workflows. The user's latest instruction adds glassmorphism: translucent white surfaces, fine highlights, soft shadows and diffused warm/green background shapes.

Airday keeps its own name, copy and original SVG artwork. The reference site's branding, proprietary typeface, imagery and source code are not included.

## Typography and layout

Use Archivo Black for the large introduction and page titles; Manrope for navigation, controls and factual content. Hindi uses Nirmala UI/system fallback. Font licenses ship in third-party notices.

- Main container: maximum 1280px with desktop inner gutters of 32px.
- Floating capsule navigation: maximum 1120px, 72px minimum height.
- Hero heading: 40–72px desktop; 38–48px on phones.
- Other page headings: 32–48px desktop; compact responsive scale on phones.
- Paragraphs: readable sans-serif with balanced introductory lines.
- Feature fan: five original illustrated posters; horizontal scroll-snap on phones.
- Work areas: related two-column groups on desktop, stacked forms on phones.
- Footer: explanatory copy, navigation and source attribution above a large Airday wordmark.

## Shared components

The production source of tokens and treatments is src/glass.css.

Navigation, working cards and dialogs have translucent surfaces and backdrop blur. Dark next-action cards preserve high-contrast text. Normal input interiors remain near-solid for readability. Avoid nesting expensive blur effects.

Buttons use pill shapes, clear dark/neutral hierarchy, immediate pressed feedback and visible keyboard focus. Forms retain native input semantics, labels, error text and disabled states. Cards group work, rather than disguising every record as a button.

Loading, empty, stale, unavailable, conflict and failed-save messages retain their original factual language and recovery controls. Never hide them for a cleaner screenshot.

## Feature explorer and motion

FeatureShowcase maps all 32 feature entries to existing views or their availability information. The static five-poster navigation and complete disclosure directory remain usable without motion.

Fine mouse pointers can reveal a trail of feature cards. Cards are pointer-transparent, limited to six, distance-throttled and expire after about 1.2 seconds. They do not contain exclusive information or intercept controls. All artwork is original inline SVG.

Existing GSAP powers the trail, short route/dialog transitions and spring navigation. Navigation preserves current velocity when retargeted. Native scrolling remains in control; no pinned marketing sections or artificial loading delays.

## Accessibility and responsive behavior

Retain English/Hindi support, native dialogs, return focus, keyboard navigation and chart/table alternatives. Narrow screens down to 320px must not cause document overflow. Main inputs stay at 16px on mobile.

Respect prefers-reduced-motion: no cursor trail, no poster tilts/transitions, immediate navigation placement. Respect prefers-reduced-transparency and increased contrast with solid surfaces; unsupported backdrop-filter browsers also receive readable surfaces. Do not override system accessibility preferences to obtain a prettier screenshot.

## Features and release boundaries

Routes, API contracts, plan state, evidence handling, persistence and feature gates remain unchanged. R0R2 is the active release; existing R3/R4/R5 integrations are visible as availability entries and remain subject to their configuration, accounts, providers and hardware. Do not label unavailable capabilities as working.

The complete feature placement table and verification limitations are in REFERENCE_UI_REVIEW.md. Historical reviews remain historical; they are not evidence for the current presentation.

## Asset and dependency policy

Manrope and Archivo Black are self-hosted Google Fonts distributions with OFL text included. No new JavaScript dependency was added for this reference redesign: it reuses the installed GSAP packages. No reference image, brand asset, script or minified bundle is shipped.

