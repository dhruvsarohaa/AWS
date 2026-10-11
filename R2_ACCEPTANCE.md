# R2 local acceptance

Updated **11 October 2026, Asia/Kolkata**. Active scope: R0, six R1 features and ten R2 features. R3 is paused; R4/R5 are deferred. AWS publication and deployed acceptance remain separate from this local evidence.

## Final automated gate

**314/314 checks pass, across 24 scoped test files; no failures or skipped checks.** This comprises the previous 186 R0/R1 regressions plus 128 new checks: 34 R2 data, 46 personal planning/feedback, nine offline projection/worker, ten offline transaction fault-model, four accessibility style, 17 monitor-selection/capacity and eight release-scope cases. Browser interactions below are separate evidence, not included in the test count.

Final log: `.airday-local/r0-r2-acceptance-test.log`.

```powershell
$env:TMP = Join-Path (Get-Location).Path '.airday-local/test-temp'
$env:TEMP = $env:TMP
$releaseTests = @(Get-ChildItem tests -Filter '*.test.mjs' -File |
  Where-Object { $_.Name -notmatch '^r[345](?:[-.]|$)' -and
    $_.Name -notin @('workspace.test.mjs','pilot-integration.test.mjs') } |
  Sort-Object Name | ForEach-Object { $_.FullName })
node --test @releaseTests
pnpm build
pnpm build:api
pnpm lint
pnpm check:config
pnpm check:security
pnpm check:infra
```

TypeScript/Vite/PWA build, API bundling, full lint, configuration schemas and infrastructure contracts pass. The credential-pattern scan found no matching literals; it does not establish absence of vulnerabilities. SAM `validate --lint` and deployment PowerShell syntax were checked separately. Later-phase feature suites were excluded deliberately.

## Feature evidence

| Feature | Automated evidence | Actual browser evidence |
| --- | --- | --- |
| F03 Station map/list | Admission, India/unit/distance eligibility, explicit indoor exclusions, recency lookups, provenance and observation timestamp tie-break | Consent disclosure precedes loading; fresh/old/missing-coordinate list entries; frozen station drawer; Escape returns focus; map marker and list show the same 42 µg/m³ synthetic reading. Blocked OSM tiles show a failure notice while list/markers remain available. Unknown-coordinate station omitted from map. Unloading removes map layers. |
| F04 Favorites | Five-area bound, rounded-only persistence, context identity, rename/upsert/delete, invalid input and backup conflicts | Save and rename survive reload; switch selects the rounded area's context; fifth favorite saves and sixth is disabled. Deleting one favorite leaves four and reports a saved write. Existing R0 slow-location-response checks cover the shared location-change handler. |
| F07 Evidence trends | Date/scope/cursor validation, source/sensor eligibility, immutable retained runs, expiry and 501-row observation pagination | Blank date disables loading. Model catalog returns 50 runs then one, and selecting that run loads its retained body. Observation history returns 500 rows then one, without an error. Incomplete page means are withheld. |
| F09 Recap | Frozen original/chosen minutes, lifecycle deduplication, incomplete chosen duration, date/location filtering and empty states | Today's reviewed indoor action shows one review, 60 original scheduled minutes, zero chosen outdoor minutes and one self-reported followed action. Future decisions are outside the current-day recap. |
| F10 Concentration × time | Exact interval overlap, original/chosen separation, stale/future/partial withholding and frozen exports | A synthetic 08:00–09:00 original window shows 100 µg·h/m³; its recorded 10:00–11:00 alternative shows 25. Current estimates are distinguished from frozen historical evidence and inhaled dose. |
| F11 Pollutants | Valid units/series metadata, legacy PM fallback, valid zeros and missing gases | All six tabs exercised. Gas-outage NO₂ shows no mean with zero covered hours; O₃ shows valid 0.0, and CO shows 500.0. PM planning remains based on PM2.5. |
| F12 Period comparisons | 1/8/24-hour overlap, midnight, incomplete/overlapping intervals and source incompatibility | Blank native time displays an alert without crashing; returning to 00:00 restores a complete zero O₃ mean. Model and observed means remain separate. |
| F19 Feedback | Assessment-linked bounds, deduplication, escaped text, immutable projection and repository/journal context checks | Local note saved and survives reload. Feedback remains private and separate from provider requests. |
| F20 Private progress | Frozen record counts, no coordinates in exports, deletion review snapshot/conflict checks | Feedback deletion has explicit review, export and cancellation. Escape cancels and returns focus. Confirming clears feedback while retaining planning and journal records. |
| F21 Offline reading | Five-area atomic eviction, corruption preservation, clearing/save race, public allowlist, dated-shell navigation, API/auth/tile exclusions and built dependency completeness | Native IndexedDB retains five rounded public snapshots after six areas, evicting the oldest Delhi snapshot. Service-worker caches contain static startup assets only. Waiting update notice preserves an open draft. Closing clients activates the update. Dated URL reload works with browser network disabled, including observations-only evidence; original clocks remain, and refresh/retry/decision controls are disabled. Restoring network permits fresh retrieval. |

## Repairs found during this pass

- Monitor lookup no longer chooses candidates solely by distance. Actual observation time decides freshness; catalog recency only orders bounded lookups. A same-site sensor tie now selects the newer measured timestamp.
- Station capacity is validated at 20–40, without eviction of other users' active stations. This local run uses 40; the scoped deployment defaults to 40. Quota budgets still bound requests and retries.
- History contracts and sensor catalogs reject incompatible or malformed evidence. Retained catalog pointers share the forecast body's expiry. Invalid comparison dates/times cannot throw during render.
- Original and chosen concentration-time windows no longer compare a rescheduled window with itself. Unknown chosen minutes stay unknown.
- Feedback storage uses one shared validator and an explicit field projection. Confirmed deletion cannot operate against a changed planning snapshot.
- Public cache save and read both project allowlisted fields and round selected coordinates. Old unsupported bytes are preserved for recovery; they are not silently replaced with an empty document.
- Offline shell routing accepts validated planning-date URLs. Arbitrary queries, public/action/auth routes, API responses and map tiles remain outside its fallback/cache.
- **Actual offline reload initially failed:** a shared stylesheet still imported by the planner was excluded. The fix includes that stylesheet and validates all public startup dependencies against Vite's build manifest. The repaired native offline reload passed. Lazy map and deferred-feature code remain excluded.
- Offline provider labels now withhold current verification rather than showing a fresh provider badge from an earlier fetch. Original retrieval and observation clocks remain intact.
- Native history continuation initially failed because the synthetic fixture wrote plain timestamp keys; production writes timestamp plus record hash. The fixture and regression now match production. Cursor validation was not weakened and the production backend did not require a pagination repair.
- R2 controls now have contrasting boundaries, 16px input text, bounded wrapping, larger map targets and reduced-motion rules. Hindi selection updates the document language.
- Default API and frontend scope disables R3/R4/R5 surfaces. Scoped AWS infrastructure omits optional staff-account/email resources.

## Device/accessibility evidence and limits

The Codex in-app Chromium browser exercised all five views at **320, 390, 768 and 1280 CSS pixels**: 20 rendered checks, with no page-level horizontal overflow. Hindi views were included. Native dialogs, Escape/focus return, labelled inputs, disclosure controls, accessible chart tables, errors and disabled states were exercised. R2 form borders are approximately 3.91:1 against white; this is a specific boundary check, not a whole-page contrast certification.

This does **not** establish physical Android/iPhone behavior, Safari/Firefox compatibility, screen-reader speech output, actual OS installation, hardware geolocation, all zoom modes or WCAG conformance. The in-app browser does not provide the complete physical-device/install environment. Prior R0/R1 browser and one-page Hindi PDF checks remain recorded in `R0_R1_ACCEPTANCE.md`.

Browser fixtures run on isolated port **5177**, using generated synthetic evidence, a disposable native browser store and in-memory history. No provider keys or AWS services are used by the fixture. Its QA control script is intentionally not part of the production offline cache; restore networking and reload before changing a fixture scenario. Browser network/viewport overrides are temporary and removed after verification.

Proof: `artifacts/r2-offline-proof.png` and `artifacts/r2-browser-proof.png`.

## Live source evidence

Separate authenticated local checks found current PM2.5 in Delhi, Noida, Gurugram and Mumbai. Bengaluru correctly retains stale evidence: 41 µg/m³ measured **7 October, 20:00 IST**, selected after the timestamp tie-break. Full station/source/timestamp details and public sanitized outputs are in `MONITOR_COVERAGE.md` and `artifacts/live-api-coverage.json`.

These observations have unknown averaging intervals. Citizen-sensor/reference provenance and unverified outdoor siting stay visible. The regional forecast remains roughly 45 km model output, not school/street precision or official Indian AQI. A five-city check cannot establish universal India-wide current monitor coverage. CPCB concentrations remain disabled until their metadata contract is reviewed.

## AWS handoff

AWS profile `airday` is not authenticated. No stack or hosted URL has been created during this pass. `AWS_R0_R2_DEPLOYMENT_REVIEW.md` and `OPERATIONS.md` describe the concrete scoped stack, retention, budget estimate, sign-in and deployment smoke checks. The existing OpenAQ key is sufficient for the current scope; authentication, permissions, eligible credits, deployed headers/CORS, provider behavior and cloud recovery require the final AWS step.
