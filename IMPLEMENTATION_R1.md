# R1 implementation and local acceptance record

Updated **10 October 2026, Asia/Kolkata**. Initial implementation was recorded on 9 October; this update records subsequent local acceptance and repairs against `FEATURE_IMPLEMENTATION_MAP.md`. R0/R1 are the current verification focus, R2 acceptance follows, R3 is paused, R4/R5 are deferred and AWS deployment is last. Exact scenarios, commands and limits are in [R0_R1_ACCEPTANCE.md](R0_R1_ACCEPTANCE.md).

The tested local workflows have functional acceptance evidence. The final build, lint and one-page Hindi PDF re-export passed. Other-browser/device, full accessibility, current multi-city station coverage and deployed AWS behavior are separate gates.

## Delivered code and tested behavior

| Feature | Integrated behavior                                                                                                                             | Acceptance and limits                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01     | One-activity duration/allowed-hours/rule finder with complete future PM2.5 comparisons and optional dated decision save.                        | 15–240-minute same-day duration; up to three distinct results, ranked peak → overlap-weighted mean → earliest time. Complete/partial/zero/invalid input regressions pass. Browser acknowledgment → three windows → selected 10:00–10:30 → save/reload passed. A 15-minute search step does not imply 15-minute forecast accuracy.                                                             |
| F02     | Dated recurring/quick timeline, editable templates, explicit action selection, frozen original/chosen evidence and follow-through.              | Scope/lifecycle/chosen-time/reload/reopen/removed-history/follow-through regressions pass. Browser recurring reschedule original peak 100/chosen 25, reopening/history and school-template weekday editing/reload passed. Stale/incomplete evidence cannot resolve the review; pending choices do not cross context/lifecycle. Templates remain previews until confirmed; 75 is illustrative. |
| F05     | Local review inbox with scoped material-transition episodes and persistent dismissals.                                                          | Browser dismissal/reload then below→high re-entry passed. Material changes, threshold transitions, coverage/freshness gaps, reopening and bounded deduplication regressions pass. Dismissals do not resolve decisions; unobserved transitions while the app is closed cannot be reconstructed. No closed-tab/background notification claim.                                                   |
| F08     | Filtered frozen history, CSV export, selected print/text summary and private versioned planning backup.                                         | Private labels/reasons omitted by default; explicit opt-in includes them and coordinates stay excluded. Frozen provenance/lifecycle, zero/legacy absence, formula/quote/Unicode/HTML safety regressions pass. Browser CSV and Hindi report passed. The blank second page was repaired; final browser export and Poppler inspection confirmed one legible Hindi page.                          |
| F16     | Separate evidence-service attempt/success/observation/forecast timestamps and health states.                                                    | Browser fresh feed with old observation, failed retrieval with retained recent observation, forecast-only/queued/no-data/observation-only/partial/stale states and rejected malformed/503 responses were checked. Evidence-status/backend regressions pass. These are availability/age labels, not provider uptime/quota/SLA guarantees.                                                      |
| F17     | Deterministic English/Hindi finder, timeline, local review reasons, action labels, reports and constrained guidance; saved language preference. | Tested Hindi indoor confirmation, offline save refusal with preserved draft, reconnect save and report flow. Rules distinguish complete/incomplete/stale evidence and feasible configured options. User-written and provider text retains its original language. Broader localization and accessibility still need review; paused workspace features are outside this acceptance.             |

## R0 foundation repairs required by R1

- One schema-2 IndexedDB document retains related planning changes in a read/write transaction with expected revisions. Native browser schema-1 migration revision 4→5 preserves its original archive; concurrent stale-tab writes are rejected.
- Explicit reviewed damaged-document recovery archives the canonical/legacy originals and replacement together, rejects changes made since preview and preserves originals if the transaction cannot commit. Browser recovery revision 7→8 and model commit-failure regressions pass. Automatic silent repair is not used.
- An injected two-field save failure retains a coherent complete session change with unchanged durable storage; retry saves the complete change. Unavailable IndexedDB yields an exportable session fallback.
- Valid unconfigured plans survive migration; corrupt/oversized legacy content is preserved for recovery. Recurring/quick activity IDs cannot collide. Frozen activity definitions whitelist supported fields, preventing recursively retained earlier records.
- Backup import validates size/version/records, preserves chronology and rejects conflicting or unorderable histories. Replacement uses an inline explicit confirmation with frozen reviewed documents and revision/context recheck; cancellation/Escape restores focus.
- Wrong-place/malformed evidence is rejected. Final decision save rechecks live/fresh/scoped and materially unchanged evidence, including a dialog whose evidence expires while open.
- Partial low windows no longer imply complete below-rule coverage. Stale/future/unknown or incomplete effective-window records stay unresolved even if their condition is unchanged.
- Forecast inspection follows chosen times; original/chosen provenance remains distinct. Current review reasons are translated deterministically, while user reasons are preserved verbatim. System-local fonts and table alternatives remain in use.

Subsequent task-screen/UX details are in [FRONTEND_UX_IMPLEMENTATION.md](FRONTEND_UX_IMPLEMENTATION.md). Its older notes and the initial 9 October implementation/check outcomes are historical; the current acceptance ledger supersedes them where described above.

## Local flow

1. Use one consistent production local origin, such as `http://127.0.0.1:5174/`, to keep its browser storage. Confirm a place.
2. Choose a date; request a quick comparison or review/save a recurring timetable/template.
3. Compare usable future windows, choose a response, enter a reason and acknowledge any indoor alternative. The final save rechecks the evidence before the dated activity/context/record commit together.
4. Inspect chosen times, record follow-through or reopen. Material evidence changes require another review; dismissing an alert does not resolve it.
5. In History, select the dated frozen report. Private CSV/print/text labels/reasons require explicit opt-in. Settings provides the complete private JSON planning backup and reviewed import/recovery.

Optional workspace behavior belongs to paused R3 and is outside this acceptance. Stored history retains coarse coordinates, not detected GPS. Shareable CSV/print/text excludes coordinates; complete planning JSON backups remain private recovery data and include retained user fields.

## Checks and outstanding verification

The scoped aggregate passed **186/186 tests**, including **81 new acceptance cases and 105 existing regressions**. Production frontend/TypeScript/Vite/PWA and API bundling passed; full lint passed. Suite counts, the explicit aggregate command and distinctions between transaction-model, server-render and actual browser evidence are in `R0_R1_ACCEPTANCE.md`.

Actual browser interactions used the isolated production-build QA origin on port 5176 with labelled synthetic data. Native migration/recovery, concurrent tabs, fault-injected storage failures, backup controls, finder/timeline/template/alert/Hindi/private-export workflows, separate source-health states and 390-pixel no-overflow layout were exercised. The PDF check exposed a blank second page; print viewport minimum heights were removed, and final re-export/visual inspection passed on one page with a white canvas. No physical-device, every-browser or accessibility certification is inferred.

The live local Delhi forecast returned HTTP 200 with 72 hourly points. Authenticated OpenAQ returned one reading dated 7 October, correctly stale; present-day monitor coverage remains unproven. Multi-city provider freshness, reviewed CPCB metadata, physical-device/high-zoom/screen-reader review, R2 production install/offline acceptance and AWS deployment/operations remain release gates. No vulnerability-free enterprise certification is claimed.

## Next acceptance bundle

With the listed local R0/R1 checks complete, verify the ten integrated R2 features: maps/favorites, retained evidence history, recaps, concentration-time estimates, pollutant/period views, private feedback/progress and production offline behavior. R3 remains paused and R4/R5 remain deferred. AWS follows accepted local workflows.
