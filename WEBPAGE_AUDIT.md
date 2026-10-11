# Airday webpage audit — current implementation

**11 October 2026 update:** all 35 findings have been rechecked against the current release. Historical follow-through, sign-in/configuration retry and transient-control focus repairs were completed in the submission pass. See [SUBMISSION_UI_AUDIT.md](SUBMISSION_UI_AUDIT.md) for the current feature/UI inventory, each finding's disposition, skipped work and verification. The original findings and old line references below are retained as history.

Audit date: **8 October 2026 (IST)**.

## Implementation update — data and state integrity

**Findings 1–6 and 18 are implemented in source, with offline regression checks.** The numbered descriptions below retain the original audit evidence; their line references describe the pre-repair implementation. Other audit findings remain backlog unless separately addressed. This update does not establish rendered or deployed behavior.

| Finding                           | Repair                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — location scope                | Records retain a reviewed place fingerprint and coarse area. Choices are derived by place, date and activity; changing city or coordinates cannot reuse another place's choice. Legacy records without a reviewed location remain historical.                                                                                 |
| 2 — changed evidence              | Local review and cloud approval share window assessment/change rules for threshold crossings in both directions, coverage, freshness and material peak changes. Local review also checks plan, place, guidance version/status and date. Changed records are excluded from summaries and new submissions until reviewed again. |
| 3 — provider state                | Reading age and retrieval status are separate. Failed/partial station retrievals preserve cached observations and provider errors; original last-success and observation times stay visible. Coverage ages with the same client clock as readings.                                                                            |
| 4 — reopening                     | Recorded, reopened and superseded lifecycle states live in the journal. Reopening changes chooser, summary and submission eligibility together; older actions remain history. The server rejects explicitly reopened/superseded proposals.                                                                                    |
| 5 — partial saves                 | One schema-version-3 `airday-decision-state` document saves choice, reason and evidence with one atomic storage write. Failed writes retain complete session state and report session-only saving. Unreadable canonical content is preserved and cannot silently resurrect legacy choices or be overwritten by the next save. |
| 6 — chosen window                 | Original and chosen windows/assessments are retained separately. Re-review and cloud approval assess chosen times for rescheduled/shortened actions. English/Hindi summaries label both peaks correctly.                                                                                                                      |
| 18 — late response after sign-out | Abort signals and request/session generations guard initial load, mutations, reload, expiry and unmount. Sign-out remains available during requests, and late results cannot restore private workspace state.                                                                                                                 |

Regression evidence: [decision-integrity.test.mjs](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/tests/decision-integrity.test.mjs), [decision-state.test.mjs](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/tests/decision-state.test.mjs), [evidence-status.test.mjs](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/tests/evidence-status.test.mjs), [auth-session.test.mjs](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/tests/auth-session.test.mjs) and [workspace.test.mjs](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/tests/workspace.test.mjs). Fixtures are synthetic and offline. The suite passes **120/120 checks**, including failed writes/retry/reload, both 74↔76 crossings at rule 75, chosen-window changes, legacy/corrupt storage, cached-provider outages and sign-out during deferred response/body parsing. Lint, TypeScript/production UI build, API bundles, infrastructure contracts and source credential-pattern scan pass. The pattern scan is not a vulnerability-free certification.

The Windows sandbox initially refused two temporary-file renames. The complete suite passed with `TEMP`/`TMP` pointing to `.airday-local/test-temp` in the writable workspace. No browser, authenticated provider or AWS deployment check was performed in this implementation phase. Concurrent-tab conflict handling remains finding 35; atomic storage does not solve competing edits across tabs.

## Scope and evidence

This audit covers the current dashboard, location/date flow, chart, editors, browser persistence, decision journal and optional shared workspace. It finds **35 actionable improvements**: **25 source-confirmed issues** and **10 design/resilience recommendations**. This is a prioritized set from the available evidence, not a guarantee that every possible defect has been found.

- **Confirmed** means the implementation supports the described issue. It does not mean the behavior was reproduced in a browser; platform-specific interactions still need verification.
- **Recommendation** means an improvement supported by the current flow, not a demonstrated rendered defect.
- **P1:** fix before a public/institutional pilot. **P2:** next usability/reliability pass. **P3:** smaller polish or maintenance work.
- Read-only browser lookup of `http://localhost:5174/` was **rejected by automatic approval review** because localhost automation had previously been denied. The rejection explicitly prohibited bypass. No screenshot, DOM read, browser interaction, localhost fetch or other workaround was used in this audit.
- Source and interaction paths were reviewed independently across accessibility, planning/data trust and shared-workspace recovery. No app code was changed and no test suite was run for this audit.
- The original [DESIGN_AUDIT.md](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/DESIGN_AUDIT.md) describes twenty earlier findings and their repairs. Those remedies are present; this report audits the later implementation and does not relabel the old list as unfixed.

## What is already working in the implementation

Preserve these foundations: labelled previews; concentrations and units distinct from official AQI; regional-model limitations; separate monitor identity/time/distance cards; missing/stale data handling; accessible chart table/hour selector; native dialogs; plan-field validation; browser-save failure feedback; activity-removal Undo; visible focus and reduced-motion rules; constrained alternatives; evidence-linked decisions; and cloud roles/audit/approval checks.

The selected backend architecture annotation remains relevant: preserving cached evidence and hiding ambiguous CPCB concentrations are useful controls. They need equally clear frontend states. A defined SAM stack is not evidence of a deployed, verified AWS service. This webpage audit is not an AWS penetration test, WCAG certification or a claim of validated forecast accuracy.

## Evidence, decisions and state

### 1. Decisions carry into a different city — P1

**Confirmed.** Choices and displayed records match date + activity ID; the local record has no reviewed location. Changing Delhi to Pune can retain the previous decision.

Evidence: [src/App.tsx:351](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:351), [src/App.tsx:1359](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1359), [src/types.ts:126](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/types.ts:126).

**Improvement:** Record location/area with every decision, scope current choices by location, and require review after a location change. Keep older records under their original place.

**Done when:** A Delhi choice is never presented as the current Pune choice.

### 2. Local review misses meaningful evidence changes — P1

**Confirmed.** The warning checks plan/policy hashes, coverage and a large peak delta. It omits a threshold crossing, forecast age and policy status. At rule 75, 74→76 can cross the rule without a warning.

Evidence: [src/App.tsx:1406](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1406), [api/workspaces.mjs:344](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/api/workspaces.mjs:344).

**Improvement:** Use one shared material-change assessment for local and cloud decisions, including crossing, freshness, policy status and location.

**Done when:** 74→76, fresh→stale and reviewed→verification-needed each reopen review.

### 3. A retained station reading hides a provider failure — P1

**Confirmed.** The backend retains earlier evidence with an unavailable status, but the page replaces that status and reason whenever a cached row exists. Observation age remains visible; retrieval failure does not. The coverage badge also uses the server snapshot while station-age badges change with the client clock.

Evidence: [api/engine.mjs:311](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/api/engine.mjs:311), [src/App.tsx:1699](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1699), [src/App.tsx:1120](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1120).

**Improvement:** Display reading freshness and feed retrieval status independently: “Recent reading; refresh failed.” Preserve provider errors and last successful retrieval time. Derive coverage freshness consistently.

**Done when:** A failed adapter stays visibly failed while its usable cached observation remains inspectable.

### 4. Resetting to Pending leaves the old action active elsewhere — P1

**Confirmed.** Pending review updates only the choices map. The old journal entry remains “Recorded,” remains the latest summary, and can still be submitted for shared approval.

Evidence: [src/App.tsx:510](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:510), [src/App.tsx:1393](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1393), [src/components/WorkspacePanel.tsx:209](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/WorkspacePanel.tsx:209).

**Improvement:** Represent reopening/superseding a decision explicitly in the journal and derive current state from it. Prevent submission of superseded actions.

**Done when:** Reopening an action changes its card, summary and submission eligibility together.

### 5. Decision choice and evidence can save separately — P1

**Confirmed.** The choices map and journal are written to separate localStorage keys. One write can succeed while the other fails, leaving a choice without its reason/evidence or a journal action inconsistent with the chooser after reload.

Evidence: [src/App.tsx:568](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:568), [src/lib/storage.ts:90](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/lib/storage.ts:90).

**Improvement:** Save one versioned decision document per update and derive the choices map from current journal state. Retain session-only feedback and export recovery.

**Done when:** A failed write cannot leave a persisted action without its corresponding evidence and reason.

### 6. Chosen windows are not reassessed locally — P1

**Confirmed.** A rescheduled/shortened record stores the original activity assessment; later warnings also compare the original window. Shared proposals assess chosen times, producing different local and cloud behavior.

Evidence: [src/App.tsx:536](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:536), [src/App.tsx:1408](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1408), [api/workspaces.mjs:277](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/api/workspaces.mjs:277).

**Improvement:** Store original and chosen assessments, then evaluate changed evidence against the chosen window using the same pure functions on both sides.

**Done when:** If a chosen 10:00–11:00 window worsens, its record requests review even when the original window is unchanged.

### 7. Unavailable forecasts read as endless waiting — P2

**Confirmed.** Summary state uses forecast existence rather than request/source state; an unavailable forecast, observations-only response or capacity rejection can still produce “Waiting for a regional forecast.”

Evidence: [src/App.tsx:617](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:617), [src/App.tsx:662](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:662).

**Improvement:** Distinguish initial loading, queued refresh, unavailable forecast and observations-only mode. Show the reason and a relevant retry beside the primary summary.

**Done when:** A completed failed request stops appearing as an unfinished load.

## Planning and retained history

### 8. Fixed activities offer an impossible reschedule — P2

**Confirmed.** Every activity offers Choose another time, but the editor rejects all reschedules when flexible is false. Starter activities have no flexible flag.

Evidence: [src/App.tsx:1375](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1375), [src/components/DecisionEditor.tsx:105](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/DecisionEditor.tsx:105), [src/lib/planner.ts:21](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/lib/planner.ts:21).

**Improvement:** Explain that the activity is fixed and offer Edit allowed times, or enable rescheduling only when constraints support it.

**Done when:** A fixed activity does not send users into a form that cannot succeed.

### 9. The same action cannot be recorded again directly — P2

**Confirmed.** The record control is a select already set to the previous action. Selecting the same option does not trigger onChange, even when a warning asks for a new review.

Evidence: [src/App.tsx:1358](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1358), [src/App.tsx:1413](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1413).

**Improvement:** Add an explicit Review/record again button with the previous action prefilled and new evidence captured.

**Done when:** A user can reaffirm Keep outdoors against updated evidence without choosing an unrelated action first.

### 10. Saved decisions do not resolve the headline review state — P2

**Confirmed.** Summary counts and chart highlights assess the original recurring schedule regardless of indoors, cancelled, shortened or rescheduled decisions.

Evidence: [src/App.tsx:604](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:604), [src/lib/planner.ts:192](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/lib/planner.ts:192).

**Improvement:** Separate unresolved reviews from recorded actions. Show the dated chosen plan beside the original baseline without silently editing recurrence.

**Done when:** Recording an action changes the review status and chosen window while preserving the original plan for comparison.

### 11. Past decisions and follow-through are mostly inaccessible — P2

**Confirmed.** Forecast navigation exposes today/future dates, and cards expose only the latest record for a current activity. Older dates/revisions and removed activities remain stored but are available mainly through JSON export.

Evidence: [src/App.tsx:952](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:952), [src/App.tsx:1383](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1383).

**Improvement:** Add a journal view independent of forecast dates, with date/location/activity filtering, revisions and follow-through controls.

**Done when:** Yesterday’s action can be inspected and marked followed today, including after its activity is removed.

### 12. The summary can describe a different date or activity — P2

**Confirmed.** The summary always receives the final journal row, independent of the selected day, place or highlighted activity.

Evidence: [src/App.tsx:1738](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1738).

**Improvement:** Show the summary for an explicitly selected record; label its date, place and activity in the collapsed title.

**Done when:** Changing the dashboard date does not quietly display an unrelated record as its decision summary.

### 13. Exports lose the reviewed historical plan context — P2

**Confirmed.** Export combines today’s current plan with historical journal entries. Local records omit original times and location, so a plan edit can make an old decision impossible to reconstruct.

Evidence: [src/App.tsx:575](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:575), [src/types.ts:126](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/types.ts:126).

**Improvement:** Include immutable reviewed activity/window/location and plan snapshots or resolvable versions in a versioned export.

**Done when:** An exported old decision still explains its original place, times and rule after the plan has changed.

### 14. Valid alternative windows are suppressed — P2

**Confirmed.** The non-overlap filter compares candidates against all earlier ranked candidates, including candidates it has rejected. Rejected overlapping starts can suppress later valid alternatives.

Evidence: [src/lib/planner.ts:321](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/lib/planner.ts:321).

**Improvement:** Build a greedy list of accepted windows; compare each new candidate only with accepted windows and stop at three.

**Done when:** Equal-valued one-hour windows can return distinct non-overlapping alternatives instead of only the first.

### 15. Indoor suitability confirmation starts pre-checked — P2

**Confirmed.** The decision checkbox is initialized from indoorAvailable. Availability configured in the plan is treated as confirmation of a suitable indoor option for this decision.

Evidence: [src/components/DecisionEditor.tsx:24](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/DecisionEditor.tsx:24), [src/components/DecisionEditor.tsx:141](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/DecisionEditor.tsx:141).

**Improvement:** Keep availability and current suitability confirmation separate. Start the decision confirmation unchecked and explain what the user is confirming.

**Done when:** An available room does not automatically attest to its suitability for the current action.

## Shared workspaces and recovery

### 16. Failed/cancelled sign-in removes its own retry path — P2

**Confirmed.** Config is stored after finishSignIn. A callback error leaves config null and displays the unconfigured-deployment message. Configuration retrieval also has no explicit retry.

Evidence: [src/components/WorkspacePanel.tsx:59](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/WorkspacePanel.tsx:59), [src/components/WorkspacePanel.tsx:103](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/WorkspacePanel.tsx:103).

**Improvement:** Retain valid configuration before handling callbacks, model loading/unconfigured/error separately, and provide retry/sign-in recovery.

**Done when:** Cancelling sign-in or failing its exchange leaves a usable retry control and an accurate status.

### 17. A committed cloud update can appear to have failed — P2

**Confirmed.** The mutation and following GET share one try block. A successful save followed by a failed reload produces a general failure; retrying a proposal then returns a duplicate error.

Evidence: [src/components/WorkspacePanel.tsx:74](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/WorkspacePanel.tsx:74).

**Improvement:** Use the mutation response to acknowledge success, then treat a failed refresh separately. Provide Reload and idempotent submission behavior.

**Done when:** A committed decision remains visibly submitted even if fetching the list fails.

### 18. A pending response can restore workspace data after sign-out — P1

**Confirmed.** Sign out remains available during run(). A previously started GET can resolve later and call setWorkspace after the session and view were cleared.

Evidence: [src/components/WorkspacePanel.tsx:79](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/WorkspacePanel.tsx:79), [src/components/WorkspacePanel.tsx:168](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/WorkspacePanel.tsx:168).

**Improvement:** Invalidate outstanding requests on sign-out and guard state commits by session generation. Treat hosted-session logout separately and label its scope.

**Done when:** Shared reasons, plans and audit data never reappear from a late response after local sign-out.

### 19. Only the latest local record can be submitted — P2

**Confirmed.** The submission button always posts journal.at(-1), so earlier activity records have no submission path. It also remains enabled for a record already submitted.

Evidence: [src/components/WorkspacePanel.tsx:200](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/WorkspacePanel.tsx:200).

**Improvement:** Submit from individual eligible journal records, show submitted/approved state, and recover repeated submissions without a confusing error.

**Done when:** Three activity decisions can each be submitted once and their state remains visible.

### 20. Pending proposals need a review lifecycle — P2

**Recommendation.** Shared cards expose approval and follow-through; they do not expose revise, request changes or supersede actions. A proposal invalidated by changed evidence remains pending.

Evidence: [src/components/WorkspacePanel.tsx:268](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/WorkspacePanel.tsx:268), [api/workspaces.mjs:344](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/api/workspaces.mjs:344).

**Improvement:** Add explicit request-changes/superseded states and a linked new review; display proposer/approver identities, timestamps and human-readable status.

**Done when:** An invalid proposal has a visible next action and historical relationship to its replacement.

## Accessibility and chart comprehension

### 21. Browsing the decision select can unexpectedly open a modal — P2

**Confirmed.** onChange opens the dialog and immediately moves focus. Native selects that commit arrow-key changes can interrupt users while they explore options; actual platform behavior needs checking.

Evidence: [src/App.tsx:1363](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1363), [src/components/DecisionEditor.tsx:43](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/DecisionEditor.tsx:43).

**Improvement:** Keep selection as a draft and require a clearly labelled Review decision button to open the dialog.

**Done when:** Keyboard users can browse every option without focus being moved automatically.

### 22. Decision errors mark the wrong field invalid — P2

**Confirmed.** Time and indoor-confirmation errors set the Reason textarea invalid. The controls that actually failed lack associated errors and first-error focus.

Evidence: [src/components/DecisionEditor.tsx:84](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/DecisionEditor.tsx:84), [src/components/DecisionEditor.tsx:136](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/DecisionEditor.tsx:136), [src/components/DecisionEditor.tsx:156](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/DecisionEditor.tsx:156).

**Improvement:** Track field-specific errors, associate each message with its control and focus the first invalid field.

**Done when:** An invalid end time identifies and focuses the end-time field, not Reason.

### 23. Discard confirmation is hard to discover from the keyboard — P2

**Confirmed.** The decision editor appends the discard prompt below the form without moving focus. The old form remains active; new discard classes also lack the established discard-panel/danger styles.

Evidence: [src/components/DecisionEditor.tsx:29](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/DecisionEditor.tsx:29), [src/components/DecisionEditor.tsx:190](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/DecisionEditor.tsx:190), [src/App.css:940](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.css:940).

**Improvement:** Focus Keep editing when confirmation appears, restore the prior field on dismissal, and reuse the styled confirmation/destructive-control components.

**Done when:** Escape exposes an obvious Keep editing/Discard choice on short viewports and by keyboard.

### 24. Feedback dismissal and Undo remove the focused control — P3

**Confirmed.** Dismiss and Undo remove themselves from the document without placing focus on a stable replacement.

Evidence: [src/App.tsx:476](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:476), [src/App.tsx:982](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:982).

**Improvement:** Restore focus to a stable plan control or nearby relevant action when transient controls disappear.

**Done when:** Keyboard focus stays meaningful after dismissing feedback or undoing a save.

### 25. An isolated valid forecast point can be invisible — P2

**Confirmed.** A single valid value surrounded by gaps produces only an SVG move command; persistent markers exist only for the selected hour. Data outside that selected hour can therefore disappear visually despite being available in the table.

Evidence: [src/components/ForecastChart.tsx:38](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/ForecastChart.tsx:38), [src/components/ForecastChart.tsx:148](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/ForecastChart.tsx:148).

**Improvement:** Draw markers for isolated samples and retain visible gaps. Keep the table and hour selector as equivalent access paths.

**Done when:** A day with one non-selected valid hour visibly shows that sample and does not connect missing intervals.

## Layout, onboarding, language and resilience

### 26. Reduce the distance between opening the page and taking action — P2

**Recommendation.** Intro, location card, date controls, feedback and evidence sections precede the full activity flow. The exact number of mobile screens is unverified.

Evidence: [src/App.tsx:711](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:711), [src/App.tsx:1034](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1034), [src/App.tsx:1112](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1112), [src/App.css:1095](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.css:1095).

**Improvement:** For returning users, use a compact place/date header, one evidence-status strip and the next review action. Put detailed provenance in consistent disclosures while keeping critical warnings visible.

**Done when:** At 375 px, a returning user can identify the next activity/review and its data state quickly without reading repeated explanations.

### 27. Make setup concrete for schools and other users — P2

**Recommendation.** Starter activities are commute/lunch/walk; the demo script refers to a seeded school example. The general headline does not name the decision users will make.

Evidence: [src/lib/planner.ts:15](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/lib/planner.ts:15), [src/App.tsx:713](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:713), [DEMO.md:11](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/DEMO.md:11).

**Improvement:** Offer explicitly selected school/personal/outdoor-work templates and a short setup path. For the school demo use PE/recess/assembly, label example activities, and explain the user-set threshold.

**Done when:** A school user can reach one personal activity review with an accurate demo narrative and no unlabelled seeded air values.

### 28. Show the result of choosing an alternative — P2

**Recommendation.** Buttons show candidate model peaks, but the retained summary displays the original peak and a chosen time rather than a clear original/chosen comparison.

Evidence: [src/App.tsx:1338](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1338), [src/lib/summary.ts:26](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/lib/summary.ts:26).

**Improvement:** Show original versus chosen regional model peak, duration and outdoor minutes rescheduled/shortened. Label follow-through as user reported.

**Done when:** A user and judge can see what changed without interpreting three separate cards; no health benefit or measured dose reduction is implied.

### 29. Hindi support should cover the working flow — P2

**Recommendation.** Hindi is available for the summary, while navigation, errors, setup and forms remain English.

Evidence: [src/components/DecisionSummary.tsx:9](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/DecisionSummary.tsx:9), [src/App.tsx:715](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:715), [index.html:2](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/index.html:2).

**Improvement:** Add a persisted English/Hindi interface choice covering controls, validation, data states and date formatting; update document language and verify terminology with users.

**Done when:** A Hindi-reading user can complete location→plan→decision→follow-through without switching to English-only instructions.

### 30. Replace internal status and ID wording with user-facing context — P2

**Recommendation.** Coverage uses underscore replacement; decisions show raw choice enums; shared guidance and audit views show raw statuses and actor identifiers.

Evidence: [src/App.tsx:1120](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1120), [src/App.tsx:1393](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1393), [src/components/WorkspacePanel.tsx:240](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/WorkspacePanel.tsx:240), [src/components/WorkspacePanel.tsx:297](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/components/WorkspacePanel.tsx:297).

**Improvement:** Use shared human-readable labels, local IST dates and name/role displays. Keep full hashes and provider details in an evidence disclosure. Add a brief pollutant/unit glossary near relevant values.

**Done when:** Users can explain the action, evidence limits and responsible person without decoding internal identifiers.

### 31. Provide complete local-data recovery and privacy controls — P2

**Recommendation.** There is a Forget location control and JSON export, but no in-app plan/history import, journal selection cleanup or complete local-data reset. Export retention and the 200-record cutoff need clearer discoverability.

Evidence: [src/App.tsx:755](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:755), [src/App.tsx:575](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:575), [src/App.tsx:1497](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1497), [src/lib/storage.ts:114](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/lib/storage.ts:114).

**Improvement:** Add a settings/recovery panel with validated import, version/migration handling, clear scope of reset, export-before-reset and understandable retention. Use confirmation for destructive deletion.

**Done when:** A user can move or recover a plan and understand how to remove browser-saved records on a shared device.

### 32. Remove an avoidable external font dependency — P3

**Recommendation.** The global stylesheet imports Google Fonts. Fallbacks exist, but this introduces another request/dependency and no Hindi-specific typography choice.

Evidence: [src/index.css:1](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/index.css:1).

**Improvement:** Use a strong system stack or self-host licensed subset fonts, including readable Devanagari. Measure before/after layout and startup on slower networks.

**Done when:** Core reading remains stable when the font host is unavailable; no performance claim is made without measurement.

### 33. Add a recoverable rendering boundary and stronger response validation — P2

**Recommendation.** The root renders App directly; the client checks only part of the dashboard envelope before casting it. Current backend validation is valuable but does not replace frontend recovery from incompatible deployments or corrupted state.

Evidence: [src/main.tsx:7](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/main.tsx:7), [src/App.tsx:172](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:172), [src/lib/storage.ts:114](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/lib/storage.ts:114).

**Improvement:** Validate nested response/storage schemas and introduce a scoped error boundary with Retry/export/recovery actions. Separate stale/offline states from permanent errors.

**Done when:** A malformed response produces a recoverable message rather than a blank dashboard, while usable independent evidence remains accessible.

### 34. Simplify frontend state and avoid repeated planner computation — P3

**Recommendation.** App owns many unrelated states and renders the full dashboard. alternativeWindows is computed twice per flexible activity, with recurring clock updates. No device performance benchmark was run.

Evidence: [src/App.tsx:72](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:72), [src/App.tsx:193](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:193), [src/App.tsx:1311](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:1311).

**Improvement:** Extract location/data/journal controllers and focused components; compute each alternative set once and memoize relevant derived evidence where measurement supports it. Reuse state/status components.

**Done when:** Behavior stays consistent across local/cloud flows and a 50-activity plan is measured on a low-end device before claiming responsiveness.

### 35. Concurrent browser tabs can silently overwrite local edits — P2

**Confirmed.** Plans/choices are loaded once, then saved without a local revision check or storage-event reconciliation. Two tabs can write the same browser keys using different starting states.

Evidence: [src/App.tsx:81](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:81), [src/App.tsx:465](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/App.tsx:465), [src/lib/storage.ts:90](C:/Users/dsaro/OneDrive/Documents/ChatGPT/AWS/src/lib/storage.ts:90).

**Improvement:** Use versioned local documents, listen for external storage changes and show a conflict/Reload choice when unsaved edits exist. Preserve a recovery snapshot.

**Done when:** Editing a plan in two tabs produces a clear conflict or merge decision instead of silently losing one tab’s changes.

## Suggested page hierarchy

For returning users:

1. Compact **place + plan date + data state** header.
2. **Next review** with unresolved versus recorded decisions, including a prominent applicable-policy warning when required.
3. **Activity cards:** original/chosen window → model comparison and coverage → explicit Review decision action → saved/reopened state and follow-through.
4. **Forecast and monitor evidence**, with advanced provenance/IDs in disclosures.
5. **History and summaries**, selectable by record, date and place.
6. **Optional shared workspace**, with accurate configuration/sign-in states and per-record proposals.

For first visits: choose a place → explicitly choose/edit a plan template → understand and confirm the review rule → review one activity. Device location remains an explicit permission-based choice.

## Implementation order

1. **Data and state integrity:** findings 1–6 and 18. Add regression checks for location changes, threshold crossings, partial saves, reopening and sign-out during an outstanding response.
2. **Complete the action loop:** findings 8–15, 19–23 and 35. Resolve impossible controls, chosen-window assessment, history and keyboard behavior.
3. **Recovery and presentation:** findings 7, 16–17, 24–34. Apply human-readable labels and compact hierarchy, then verify with users.

Automated checks should support the repaired flows; they cannot establish rendered, assistive-technology or real-user behavior by themselves.

## Rendered and user checks still required

These are **unverified checks**, not asserted visual defects:

- 320, 375, 390, 768 and 1280 px layouts; 200% zoom and narrow reflow; long station names, Hindi text and 50 activities.
- Keyboard-only search, every action choice, same-action re-review, validation, Escape/discard, Undo and focus restoration.
- Screen-reader landmarks, labelled controls, live-update verbosity, changed-evidence announcements and accessible chart/table equivalence.
- Actual contrast of rendered text, badges, focus rings, chart lines and state combinations; previous declared-color checks are not a complete conformance audit.
- Phone permission denied, timeout, approximate GPS and saved location reuse; verify copy and recovery without collecting a reviewer’s exact location unnecessarily.
- Loading, queued, forecast-only, observations-only, no-data, old-data and provider-outage states; approved guidance becoming unverified; navigation during background refresh.
- Cloud sign-in cancelled/expired, successful write + failed refresh, duplicate submission, plan conflicts and sign-out with a request in flight; use authorized test accounts after deployment.
- Slow/offline network and measured startup/interaction behavior on a low-end phone; rendering failure recovery and external-font failure.
- A representative user completing one school PE/recess decision, finding yesterday’s follow-through, and explaining the difference between a model, a station reading and an official direction.

## Judge-facing improvements

Show one working decision in the three-minute video: location/date → honest evidence → constrained alternative → original/chosen comparison → reasoned saved action → follow-through. Use operational outcomes such as a recorded reschedule and user-reported action completion. They do not establish cleaner city air, a measured inhaled-dose reduction or health effects.

Show real AWS resources only after deployment and verification. If demonstrating local SAM operation, say so. Make the school template/script consistent (finding 27), and avoid expanding into unrelated features before this flow is dependable.

## Completion boundary

The original source audit and prioritized report are complete. The implementation update above records repairs and offline checks for findings 1–6 and 18. Remaining fixes, browser/device checks, authenticated provider checks and deployed integration verification are still outstanding. Read-only browser inspection was rejected by automatic approval review because localhost automation had previously been denied; it was not retried or bypassed. Rendered inspection requires explicit user approval and can reveal browser-saved plans/location and displayed workspace information.
