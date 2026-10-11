# Airday: project handoff for Claude

Prepared from the repository on **11 October 2026 (Asia/Kolkata)**. This handoff describes the inspected implementation and recorded verification. No tests, live-provider requests, AWS deployment, or hardware actions were performed while preparing it.

## 1. What the product is

Airday is an India-focused outdoor activity planner. It connects air-quality evidence to a practical decision: keep an activity, move it to a lower-forecast time, shorten it, choose a confirmed indoor option, or cancel it. Users retain the reason and the exact evidence they reviewed, then record follow-through.

Schools are the first demo story. The same local planner supports walks, commuting, outdoor work, families, and community activities. Personal planning works without an account.

The core flow is:

1. Confirm an Indian place through city search or an explicit device-location request.
2. Choose today, tomorrow, or the following day in IST.
3. Create activities and a personal PM2.5 review rule.
4. Inspect regional forecasts and separately identified station observations.
5. Compare feasible time windows and record a reasoned decision.
6. Revisit changed evidence, record what happened, and export or review history.

The planner is deterministic. Its core decisions do not require an LLM, and it does not train a prediction model. Forecasts come from an upstream regional model.

## 2. Current scope and status

**The active release is R0 foundations plus R1/R2: 16 added features.** R3 is paused; R4/R5 are deferred. Later-phase source exists, but source presence does not mean that an integration is released or externally validated.

`api/capabilities.mjs` defaults missing or invalid `RELEASE_SCOPE` to `R0R2`. The API rejects disabled later-phase routes before authentication, storage, provider access, or queued work. The frontend reads capabilities from `/api/config` and gates the matching controls. `template.yaml` also defaults to `R0R2`, with shared workspaces and email disabled.

**AWS deployment is pending.** Infrastructure and deployment scripts exist; the reviewed documentation does not establish a provisioned production deployment. AWS sign-in, intended account/region, permissions, credits, and deployed checks remain required.

Use these records in this order when older documents disagree:

- `R0_R2_RELEASE_STATUS.md`: current scope and functional acceptance.
- `UI_REDESIGN_REVIEW.md` and `DESIGN.md`: the latest interface and design verification.
- `AWS_R0_R2_DEPLOYMENT_REVIEW.md`: cloud deployment scope and gates.
- `MONITOR_COVERAGE.md`: dated, bounded live-provider evidence.
- `IMPLEMENTATION_R1.md` through `IMPLEMENTATION_R5.md`: implementation details and external gates.
- `FEATURE_IMPLEMENTATION_MAP.md`: all 32 candidates and historical planning, not the active release checklist.

Some README/architecture passages are older than the current acceptance and redesign records. For example, the current local planning repository is IndexedDB schema 2, and the newer records contain browser verification that earlier notes still call pending.

## 3. Implemented foundation

- Indian place search, permission-based device location, and shared place/date/language context.
- Independent forecast and monitor retrieval, with chart/table evidence, units, source attribution, original timestamps, and provenance.
- Explicit queued, unavailable, forecast-only, observation-only, partial, stale, retained-after-failure, and unconfigured-provider states.
- Recurring activities, weekday selection, personal review thresholds, flexibility constraints, and explicit confirmation of practical alternatives.
- Frozen decision evidence and original/chosen windows; recorded, reopened, and superseded lifecycle states; reported follow-through.
- One revisioned, transactional IndexedDB planning document for local state, with legacy migration, preserved recovery bytes, cross-tab conflict checks, session-only fallback, retry, and reviewed backup import/merge/replace.
- Abort/session/request-generation guards so outdated responses cannot silently replace a newer context.
- Privacy controls, coarse saved areas, explicit location removal, and separate public offline evidence storage.

An activity assessment uses the maximum available hourly PM2.5 forecast over overlapping hours. Complete coverage is required to establish a below-rule result. A partial window can still reveal a threshold exceedance, but cannot establish a clear result. The sample threshold of 75 is illustrative, not an official health limit.

Flexible alternatives preserve duration, stay within the allowed hours, use complete forecast coverage, and rank lower model peaks. The recurring-plan search examines 15-minute starting positions and returns up to three distinct options. Decisions are revalidated at save time against context, evidence changes, and freshness.

## 4. The 16 R1/R2 additions

### R1: complete decision loop

| ID | Feature | Implemented behavior |
| --- | --- | --- |
| F01 | Quick time finder | Enter an activity, duration, and permitted hours; compare ranked forecast windows, acknowledge the limitations, and record a quick decision. |
| F02 | Activity timeline and templates | Dated recurring activities, weekdays, template previews, original/chosen times, decision status, reopening, and follow-through. |
| F05 | In-app review inbox | Persistent scoped alerts for material evidence changes, threshold crossings, gaps, freshness changes, and reopened decisions; dismissal does not resolve a decision. |
| F08 | CSV and printable reports | Filtered frozen-history exports, English/Hindi summaries, and printable reports. Private names/reasons are omitted from CSV by default and require explicit inclusion; coordinates are excluded. |
| F16 | Evidence service status | Distinguishes request attempts, retrieval success, actual observation time, forecast age, missing data, and retained evidence after failure. |
| F17 | English/Hindi guidance | Deterministic planning explanations, constraints, action labels, review reasons, and reports; saved language preference. User/provider free text retains its original language. |

### R2: personal evidence and history

| ID | Feature | Implemented behavior |
| --- | --- | --- |
| F03 | Nearby-station map | Explicit Leaflet load/unload; separate selected-area, model-grid, and station markers; shared frozen station-detail drawer and accessible list fallback when tiles fail. |
| F04 | Favorite places | Save, rename, select, and delete up to five local coarse areas. Only the selected area loads; favorites do not trigger polling fan-out. |
| F07 | Historical evidence trends | Separate retained forecast runs and reconciled sensor-hour observations, bounded date ranges, charts/tables, gaps, provenance, and explicit pagination. |
| F09 | Daily/weekly recap | Counts reviewed decisions and reported actions; separates original scheduled minutes from chosen planned outdoor minutes; excludes superseded/reopened actions. |
| F10 | Concentration-time estimate | PM2.5 concentration multiplied by planned duration in µg·h/m³, with explicit sample-hold approximation and original/chosen window comparisons. It is not inhaled dose or measured exposure reduction. |
| F11 | Six pollutant views | PM2.5, PM10, NO₂, O₃, SO₂, and CO with units, dates, charts/tables, and explicit unavailable states. PM2.5 remains the activity-planning rule. |
| F12 | Period comparisons | Complete, compatible 1/8/24-hour overlap-weighted means with assumptions and included intervals; keeps forecast and observation series separate. |
| F19 | Suggestion feedback | Local useful/not-useful feedback, practical reason, optional note, and dated assessment/decision linkage; deduplication, bounded storage, reload, export, and deletion. |
| F20 | Private personal progress | Private recaps and reported follow-through, coordinate-free recap exports, separate feedback clearing, and reviewed local-data deletion. |
| F21 | Installable/offline reading | Production manifest and versioned service worker; up to five coarse public evidence snapshots in a separate IndexedDB cache; read-only offline mode, original timestamps, reconnect refresh, and updates that preserve active drafts. |

In-app alerts do not establish closed-tab email/push delivery. Offline evidence cannot authorize new decisions. A service-worker/manifest implementation does not establish successful installation on every device.

## 5. Interface and visual work

There are five persistent task views: **Today, Plan, Evidence, History, Settings**. Shared place/date/language context survives navigation. Tools, station details, activity details, setup, and plan editing use focused drawers/dialogs rather than exposing everything at once.

The latest design direction is **The Calm Field Journal**:

- Warm ivory canvas `#f4f1e9`, paper `#fcfaf5`, deep pine `#193f35`, and ink `#253b33`.
- Georgia page/action headings; Segoe UI/Nirmala UI/system sans for controls, data, English, and Hindi.
- Thin divisions, restrained corners, flat working surfaces, and selective toolbar/dialog glass.
- Desktop navigation rail, tablet navigation strip, and fixed phone bottom navigation with safe-area spacing.
- A prominent next-activity action area; desktop finder and review inbox share a workspace.
- Short GSAP view/dialog transitions and supporting-section scroll entrances, with reduced-motion handling and reduced-transparency fallbacks.
- Compact mobile date/language/refresh controls, balanced finder fields, readable form values, and visible keyboard focus.

The redesign preserved the working React/Vite implementation and features. It did not migrate to Next.js, Tailwind, shadcn/ui, Motion, or Lenis. Preserve the implemented design tokens and existing stack when continuing work unless a framework change is explicitly requested.

## 6. Data, trust, and privacy rules

- **Open-Meteo Geocoding:** Indian city/town discovery.
- **Open-Meteo/CAMS Global:** regional forecast series, with model-grid and source limitations exposed. These are not measurements at a school or home.
- **OpenAQ v3:** separately identified nearby measurements, sensor IDs, units, provider/owner, distance, timestamps, quality metadata, and history; server-side API key required.
- **CPCB/data.gov.in:** optional adapter whose numerical display remains gated by reviewed units, statistic, measurement period, and timestamp semantics. An API key alone does not clear the contract.
- **Official guidance:** manually reviewed registry records, not an LLM interpretation or an automatic threshold-triggered order. Missing/expired verification stays visible.

Keep these invariants when changing the application:

1. Preserve the distinction between a forecast, an observation, a user rule, and official guidance.
2. Preserve original observation time independently of retrieval time. Fetching an old value now does not make it recent.
3. Preserve zero as a valid value and null/missing as unavailable.
4. Never average incompatible providers, units, statistics, or periods into a new reading.
5. Keep decisions attached to the frozen evidence reviewed, including distinct original/chosen assessments.
6. Keep stale, partial, future, unknown, and unavailable evidence explicit; never fill production gaps with synthetic fixtures.
7. Keep server credentials outside frontend code and `VITE_` environment variables. Preserve existing `.env`; do not print its contents.
8. Keep personal plans/journals browser-local unless explicitly submitted through a separately enabled shared workflow.

Device coordinates are transient for location operations; server demand uses rounded 0.1° areas. Planning records retain coarse provenance/fingerprints rather than exact GPS. The optional future journey module has its own explicit exact-position consent and separate private storage.

Recorded live checks on 11 October returned 72 regional forecast points in New Delhi, Noida, Gurugram, Mumbai, and Bengaluru. Four selections had recent observations; Bengaluru retained a correctly labeled old measurement. Several recent NCR instruments were non-reference AirGradient installations. These are dated five-place checks, not nationwide coverage, calibration, forecast-accuracy, or uptime proof. Consult `MONITOR_COVERAGE.md` rather than treating those measurements as current.

## 7. Architecture and operating bounds

Actual stack: React 19, TypeScript, Vite 8, custom CSS, GSAP, Leaflet, Node ES modules, pnpm, AWS SDK v3, and AWS SAM/CloudFormation.

Local flow:

```text
React browser at 127.0.0.1:5174
  -> Vite /api proxy
  -> Node API at 127.0.0.1:3001
  -> cached evidence + queued background refresh
  -> independent provider adapters
  -> local file-backed evidence in .airday-local/

Personal planning -> browser IndexedDB
Offline public snapshots -> separate browser IndexedDB cache
```

The API returns cached evidence and schedules refresh work. Dashboard reads do not synchronously retrieve air providers. Cached geocoding is a separate bounded upstream operation. Queue/provider failures preserve usable prior evidence and original timestamps.

Defined AWS path:

```text
Amplify frontend -> API Gateway + WAF -> read Lambda -> DynamoDB
                                              -> SQS refresh queue
EventBridge -> dispatcher -> SQS -> ingestion Lambda -> providers
                                                     -> DynamoDB
                                                     -> private S3 archive
Secrets Manager -> server-side provider credentials
```

Optional Cognito and SES resources are conditioned on separately enabled future scope. The deployment script is `scripts/deploy-aws.ps1`; intended region is `ap-south-1`.

Ingestion includes leases, shared quotas covering retries, backoff/cooldowns, bounded station selection, spatial indexing, prospective forecast archives, and resumable observation reconciliation. The pilot admits up to 20 active coarse areas. Local station capacity defaults to 20 and supports a validated maximum of 40; the template defaults to 40. A station selection uses bounded returned candidates, not a guaranteed nearest monitor across the national network.

## 8. Later-phase code: preserve the release gates

**R3, paused:** shared responsibilities/proposals/approvals and follow-through, site/area groups, opt-in review email/daily briefs, a public display, public evidence API/widget, independent weather context, and satellite-fire context. Shared identity/roles derive from trusted membership, with optimistic versions and atomic audit records. These features need their separate account, delivery, licensing, provider, or operational acceptance.

**R4, deferred:** explanation-assistant contracts, route/journey functionality including local GPS/GPX storage, wearable imports, pollen, and dense-air/hotspot contracts. External network integrations are not established merely by metadata or flags. `api/pilot-config.mjs` has an empty reviewed-adapter registry.

**R5, deferred:** indoor/outdoor telemetry contracts, device registry, command lifecycle, conditional purifier automation, and site ventilation/dust-suppression gates. There are no selected supported hardware profiles, physical gateway, working actuator integration, or released automatic dispatcher. `deviceProfiles` is empty. Fixture tests establish state transitions, not real readings or actuation.

Do not turn on `Full` scope merely to expose these panels. Each capability retains its own prerequisites and verification needs.

## 9. Verification and what remains

Recorded evidence:

- R0/R1 acceptance: **186/186** checks.
- Combined active R0/R1/R2 acceptance: **314/314** checks across 24 explicit test files, excluding later-phase suites.
- Later redesign full-suite log: **431 passed, 0 failed** in `artifacts/redesign-test.log`; this broader count includes later-phase tests and is not 431 released features.
- `UI_REDESIGN_REVIEW.md` records final build/lint and browser confirmation after a subsequent mobile CSS adjustment.
- Browser records cover all five views, English/Hindi, dialogs, keyboard focus, reduced motion/transparency, and narrow 390px/320px layouts using an isolated synthetic production QA origin.
- Active-scope records also cover IndexedDB migration/conflicts/recovery, CSV/Hindi print export, offline reload/reconnect/cache eviction/update waiting, station map fallbacks, pagination, and feedback lifecycle.

Remaining gates: physical phones, Safari/Firefox, actual PWA installer behavior, screen readers, wider usability review, representative station coverage/calibration and forecast evaluation, plus AWS account/deployment and deployed HTTPS/CORS/CSP/IAM/WAF, restore, alarms, and cost verification.

Evaluation tooling exists for prospective forecast/observation pairing and bias/MAE/RMSE/threshold misses. No measured national accuracy or deployed model correction has been established. The optional experimental bias adjustment is research-only.

## 10. Run and orient in the repository

Use Node 24 or Node 22.18+ and pnpm. Preserve existing server keys/configuration.

```powershell
pnpm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
pnpm dev
```

Frontend: `http://127.0.0.1:5174/`; local API: `http://127.0.0.1:3001/`. Browser storage is origin-specific, so changing host or port changes which local records the browser sees.

Available validation commands:

```powershell
pnpm test
pnpm lint
pnpm build
pnpm build:api
pnpm check:config
pnpm check:infra
pnpm check:security
pnpm preflight
```

`pnpm test` runs the broad suite. For release-scope acceptance, use the explicit file list recorded in `R2_ACCEPTANCE.md`. SAM validation/deployment requires the appropriate installed tooling and account setup; review `AWS_R0_R2_DEPLOYMENT_REVIEW.md` before cloud actions.

Important source map:

| Area | Entry points |
| --- | --- |
| Application composition/navigation | `src/App.tsx`, `src/AppEntry.tsx`, `src/components/AppNavigation.tsx`, `src/hooks/useViewState.ts` |
| Visual system/motion | `DESIGN.md`, `src/glass.css`, `src/App.css`, `src/index.css`, `src/hooks/useAppMotion.ts` |
| Planning/time search | `src/lib/planner.ts`, `src/lib/time-search.ts`, `src/lib/activity-view.ts` |
| Decision integrity | `src/lib/decision-state.ts`, `src/lib/decision-evidence.ts`, `src/lib/decision-save.ts`, `src/lib/storage.ts` |
| Local persistence/backup | `src/lib/localRepository.ts`, `src/hooks/useLocalRepository.ts`, `src/lib/local-backup.ts` |
| Contracts/localization | `src/types.ts`, `src/lib/contracts.ts`, `src/lib/public-contract.ts`, `src/lib/labels.ts`, `src/lib/guidance.ts` |
| History/metrics/reports | `src/lib/recap.ts`, `src/lib/concentration-time.ts`, `src/lib/reports.ts`, `api/history.mjs` |
| API/runtime/providers | `api/handler.mjs`, `api/runtime.mjs`, `api/engine.mjs`, `api/providers.mjs`, `api/transport.mjs`, `api/store.mjs` |
| Release and future integrations | `api/capabilities.mjs`, `api/pilot-config.mjs`, `api/r4-integrations.mjs`, `api/r5-devices.mjs` |
| Offline/PWA | `src/lib/offlineEvidence.ts`, `scripts/build-pwa.mjs`, `scripts/pwa-policy.mjs`, `public/manifest.webmanifest` |
| Cloud/operations | `template.yaml`, `scripts/deploy-aws.ps1`, `scripts/operator.mjs`, `OPERATIONS.md` |
| Acceptance evidence | `tests/`, `R0_R1_ACCEPTANCE.md`, `R2_ACCEPTANCE.md`, `UI_REDESIGN_REVIEW.md`, `artifacts/` |

At inspection, the current `master` branch had **no commits**, and project files were untracked. Do not assume Git history already contains a backup of this implementation.

The installed Emil Kowalski and Taste skill packs are development aids, not runtime Airday features. This workspace has `.agents/skills`, and global copies also exist for Codex on this computer. Claude should use its own supported skill-discovery mechanism; a Codex `$skill-name` mention is not a universal cross-agent command.

## 11. Continuing the project

Preserve the locally accepted R0/R1/R2 flows and design. Treat current source and the latest acceptance ledger as the starting point, keep later features gated, and make targeted changes without erasing existing local data or credentials. The main next release step is the pending AWS account setup and bounded R0/R1/R2 deployment, followed by deployed verification and an honest demo of the evidence limitations.
