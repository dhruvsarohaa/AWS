# Airday reference redesign — 11 October 2026

## Reference measurements

Inspected the live https://www.pepiteboisson.ch/ page and the user's saved HTML/CSS as reference material. No reference source, scripts, logo, imagery or copy is shipped.

- Container: 1280px maximum, 32px desktop / 16px phone gutters; broad sections use 56–80px vertical padding, footer 128px on the reference.
- Palette: canvas #fcfaf8, sand #f6eee2, charcoal #231f20, cocoa #3d2f24; supporting blue #2f95ea, coral #fe6e5d, green #72be43 and teal #1d7f88.
- Type: reference Manrope body (16px/24px), 18px/28px semibold navigation; proprietary Antique Olive display, desktop hero 72px/90px, section headings 48–60px; mobile hero 48px/60px and section headings 36px/40px. Airday uses open-licensed Archivo Black for display and Manrope for body, self-hosted with their OFL files.
- Shape: floating white capsule navigation, 48px dark pill CTA, 24–40px rounded feature panels, thin dark/neutral borders, restrained shadows. Forms use clear neutral borders and familiar native inputs.
- Structure: spacious centered introduction, illustrated feature showcase, paired feature sections, large section headings, disclosure FAQ, multi-column footer and oversized wordmark. Airday adapts those sections to operational tools rather than commerce or testimonials.
- Motion: short 150ms color feedback, moving/rotated feature panels, scroll transitions. Airday retains interruptible navigation, 260–320ms dialog/view transitions, native scrolling and adds a bounded feature cursor trail.
- Reference breakpoints found in the saved CSS: 420px, 640px, 768px, 1024px, 1280px and 1536px. Airday preserves its functional 374px/760px/1023px adaptations for existing forms and navigation.
- Production tokens, spacing and component treatments live in `src/glass.css`.

## Feature mapping

Effort describes presentation integration. Existing behavior, capability checks and backend contracts remain authoritative. Disabled integrations are discoverable through availability information; this visual change does not provision or enable them.

| Feature | Placement in new UI | Effort |
|---|---|---|
| F01 Best-time finder | Hero CTA, feature poster, Today form | M |
| F02 Timeline, plan editor, templates | Plan navigation; Today timeline | M |
| F03 Nearby stations and map | Evidence; feature directory | S |
| F04 Favorite places | Places poster, context selector, Settings | S |
| F05 In-app review alerts | Today review inbox | S |
| F06 Email alerts and daily brief | Shared workspace preferences when enabled; availability entry | S |
| F07 Historical evidence | History evidence trends | S |
| F08 CSV / print / text reports | History reports and original export controls | S |
| F09 Daily / weekly recap | History recap | S |
| F10 Concentration × time | Today activity evidence and comparison | S |
| F11 Six pollutant views | Evidence pollutant controls | S |
| F12 Period comparisons | Evidence period controls and tables | S |
| F13 Public display | Settings public tools; existing separate display route | S |
| F14 Site / area groups | Settings groups when enabled; availability entry | S |
| F15 Shared responsibilities | Settings shared workspace, existing approvals and recovery | S |
| F16 Source status / freshness | Evidence status; Today forecast summary | S |
| F17 English / Hindi guidance | Today guidance and existing language selector | S |
| F18 Explanation assistant | Feature directory → pilot availability | S |
| F19 Practical feedback | Existing Today activity feedback | S |
| F20 Private progress | History private recap / export | S |
| F21 Install / offline reading | Settings install, cache and read-only states | S |
| F22 Public API / widget | Settings public tools when enabled | S |
| F23 Weather context | Evidence context when enabled | S |
| F24 Satellite-fire map | Evidence context when enabled | S |
| F25 Route comparison | Feature directory → pilot availability | S |
| F26 Foreground journey / GPX | History journey panel when enabled | S |
| F27 Wearable connections | Feature directory → pilot availability | S |
| F28 Indoor / outdoor devices | Settings device panel when enabled | S |
| F29 Purifier controls | Settings authorized device panel when enabled | S |
| F30 Pollen context | Feature directory → pilot availability | S |
| F31 Fine-scale air maps | Feature directory → pilot availability | S |
| F32 Site ventilation controls | Settings authorized device panel when enabled | S |
| Location search / detection / confirmation | Persistent context and Settings location form | S |
| Backup / import / recovery / privacy | Settings; original dialogs and validation | S |
| Help / service status | Settings links and expanded footer navigation | S |
| Loading / empty / errors / conflicts | Existing status content with shared warm surfaces | S |

Backend inventory reviewed: search/dashboard, configuration/health, bounded history, workspace, subscriptions/unsubscribe, groups, public evidence/widget, weather/fire context, integrations and device handlers. Operator-only ingestion, queues and administrative endpoints remain outside the consumer interface.

## Implementation and checks

New artwork consists of original inline SVG clock, plan, chart, report and map illustrations. Cursor cards cycle through all 32 entries, retain honest setup labels, are pointer-transparent, expire automatically and are capped at six. The static posters and complete clickable directory provide touch, keyboard and reduced-motion access. Existing GSAP is reused; no new JavaScript dependency is introduced by this redesign.

The latest user instruction makes glassmorphism mandatory. Navigation, working cards and dialogs use frosted surfaces, fine light borders and restrained shadows; diffused warm/green shapes provide depth. Dark action panels retain readable contrast. Reduced transparency, increased contrast and unsupported blur receive solid alternatives.

Reference fonts/imagery differ intentionally for licensing and Airday identity. Shared/provider/hardware features require their existing release configuration, authentication and external setup; they cannot be established end to end by a presentation-only local change. F18/F25/F27/F30/F31 have availability entries, not newly activated pilot workflows.

### Verification

- Production build and lint pass; all 431 tests pass after the final CSS correction.
- Browser: full 32-entry directory, station link focus, main navigation, finder steps, plan dialog/Escape/return focus, saved decision, reload persistence and CSV download.
- All five production views passed the 320px overflow check; mobile navigation remained 12px above the viewport bottom. Final app captures cover 1440px desktop and 390px mobile. The disabled email feature correctly focused its availability section.
- Isolated production QA: no-data forecast shows an em dash and 0/24 hours; partial forecast shows 23/24 and preserves its gap. Test decisions were created only in the explicitly synthetic localhost origin.
- Production check caught a vendor-prefix/minifier interaction that left backdrop blur on the mobile header and trapped its fixed navigation. Removing redundant hand-written prefixes lets the build generate correct standard/prefixed fallbacks.
- The browser requests reduced motion and reduced transparency. Its solid/no-trail variant is the version observed. Raw accessibility emulation was denied in the prior turn and was not retried or bypassed; normal-motion trail and translucent appearance were checked in source, not claimed as runtime-verified.
- No backend, API route, domain calculation, authentication rule or data persistence logic was changed. No AWS/provider/hardware activation or deployment was performed.

Artifacts: artifacts/reference-ui/. The local application remains at http://127.0.0.1:5174/.
