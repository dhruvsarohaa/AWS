# Submission UI audit — 11 October 2026

Latest presentation: [reference-inspired glass redesign](REFERENCE_UI_REVIEW.md). Its feature mapping, current verification and external limitations supersede earlier visual reviews; the feature dispositions below remain the release baseline.

The subsequent premium interface redesign and its verification are recorded in [UI_REDESIGN_REVIEW.md](UI_REDESIGN_REVIEW.md). [DESIGN.md](DESIGN.md) captures the implemented visual system. The feature dispositions below remain unchanged by that redesign.

Scope: review and finish the existing release, per the latest request. R1/R2 remains the active `R0R2` configuration. R3 code is preserved and paused; R4/R5 are deferred. No deployment or live provider activation was performed.

Reviewed the entry points, React/Vite/TypeScript configuration, API routes, planner/repository/report helpers, operator/evaluation commands and the three earlier UI audit documents. No new dependencies or framework migration. Production uses real API/validated retained evidence; synthetic values occur only in isolated test servers and explicitly named browser test records.

## Feature-to-UI coverage

“Usable” means connected to the real function/API and displaying its result, including unavailable/empty states. It does not promise a configured live provider or deployed AWS service. “Partial” below identifies a closed release/configuration gate, not a missing success-state component.

| Feature                                 | Function/API → UI entry                                                                                       | Before → after                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| F01 Time finder                         | `alternativeWindows`, `assessWindow` → Today / QuickTimeFinder                                                | Usable → Usable                                                                         |
| F02 Activity templates                  | `plan-templates`, validated plan save → Plan / PlanOverview + PlanEditor                                      | Usable → Usable                                                                         |
| F05 Decision timeline                   | activity view models, atomic decision save/reopen → Today / ActivityTimeline                                  | Usable → Usable                                                                         |
| F08 Reports                             | `reportDetails`, `decisionCsv`, frozen summaries → History / HistoryView                                      | Usable → Usable                                                                         |
| Historical follow-through               | `saveJournal`/atomic local repository → selected History report                                               | Partial → Usable; no current timetable/date dependency                                  |
| F16 Evidence health                     | dashboard `sources` + timestamp state → Evidence / EvidenceStatus                                             | Usable → Usable                                                                         |
| F17 Guidance                            | deterministic rule and compatible-window explanations → Today / GuidanceCard                                  | Usable → Usable                                                                         |
| F03 Station map                         | dashboard station/grid coordinates → Evidence / StationExplorer + optional StationMap                         | Usable → Usable; list remains available on map failure                                  |
| F04 Saved places                        | bounded atomic favorites → Settings / FavoritePlaces + context selector                                       | Usable → Usable                                                                         |
| F07 Retained history                    | GET `/api/history` → History / HistoryTrends; bounded pagination                                              | Usable → Usable                                                                         |
| F09 History trends                      | retained source-separated series → History / HistoryTrends                                                    | Usable → Usable                                                                         |
| F10 Concentration × time                | frozen-window integration → Today timeline / ConcentrationTime                                                | Usable → Usable; no measured-dose claim                                                 |
| F11 Pollutants                          | dashboard validated optional six-pollutant series → Evidence / PollutantExplorer                              | Usable → Usable                                                                         |
| F12 Period means                        | model/sensor interval helpers → Evidence / PollutantExplorer                                                  | Usable → Usable; incomplete intervals withhold means                                    |
| F19 Practical feedback                  | `appendSuggestionFeedback`/local commit → Today activity feedback                                             | Usable → Usable                                                                         |
| F20 Private recap                       | local lifecycle records + reported follow-through → History / PersonalProgress                                | Usable → Usable                                                                         |
| F21 Offline/install                     | generated worker + bounded public-evidence cache → Settings / OfflineControls                                 | Usable → Usable; browser/HTTPS install support varies                                   |
| Location search                         | GET `/api/search`, validated place → persistent location control / Settings                                   | Usable → Usable; explicit preview and permission states                                 |
| Dashboard evidence                      | GET `/api/dashboard`, place-bound contract → Today + Evidence                                                 | Usable → Usable; provider errors/retained age stay separate                             |
| Local backup/recovery/privacy           | validated backup helpers, original-byte recovery, guarded deletion → Settings                                 | Usable → Usable; corrupt automatic repair is absent                                     |
| App service/configuration               | GET `/api/health` + `/api/config` → Settings / ServiceStatus                                                  | Backend-only → Usable; bounded requests, retry, checked time, actual flags              |
| Optional context configuration          | same validated config → Evidence / ContextPanels                                                              | Partial → Usable discovery/error handling; feature gates below remain closed            |
| Public tools configuration              | same validated config → Settings / PublicTools + ServiceStatus                                                | Partial → Usable discovery; links appear only when enabled                              |
| F15 Shared responsibilities             | authenticated workspace plan/records/approve/reopen/follow-through → Settings / WorkspacePanel                | Partial → Partial: paused; sign-in retry and save/refresh recovery implemented          |
| F14 Site/area groups                    | local group helpers, authenticated `/groups` → Settings / GroupView                                           | Partial → Partial: paused; already has membership UI                                    |
| F06 Email alerts/brief                  | authenticated `/subscriptions`, consent/synced plan, delivery history → WorkspacePanel / NotificationSettings | Partial → Partial: paused; existing real delivery output now has loading/empty copy     |
| F13 Public display                      | reviewed GET `/api/public/evidence` → PublicTools / separate PublicDisplay                                    | Partial → Partial: paused + redistribution review gate                                  |
| F22 API/widget                          | bounded projection + `/api/public/widget` → PublicTools links                                                 | Partial → Partial: same public gate                                                     |
| F23 Weather                             | independent adapter + `/api/context/weather` → Evidence / ContextPanels                                       | Partial → Partial: paused/provider setup                                                |
| F24 Satellite fires                     | FIRMS adapter + `/api/context/fires` → ContextPanels + optional FireMap                                       | Partial → Partial: paused/product/credential gate                                       |
| Operator status/coverage/config review  | operator `status`, `coverage`, `validate-config`, preflight, monitor probe                                    | Backend-only → Backend-only: privileged operational scope                               |
| Ingestion operations                    | operator `pause`/`resume`; queues/quota/delivery reconciliation                                               | Backend-only → Backend-only: privileged operations/internal mechanisms                  |
| Cloud backup/restore/export             | operator backup/restore/export-history                                                                        | Backend-only → Backend-only: privileged storage access; local user backup already wired |
| Membership/revocation/workspace erasure | operator member/revoke/erase-workspace                                                                        | Backend-only → Backend-only: account administration, external access/deletion           |
| Forecast evaluation/benchmark           | archived data → `evaluate`, benchmark scripts                                                                 | Backend-only → Backend-only: no public read API or verified evaluation dataset          |

All sixteen R1/R2 feature IDs have user interfaces. The home tool drawer gives direct panel access in two clicks and moves keyboard focus to the target. It complements the existing five-view navigation; it does not create duplicate screens.

## Deadline plan and outcome

| Task                                                       | Type      | Effort | Impact | Outcome                                                                               |
| ---------------------------------------------------------- | --------- | ------ | ------ | ------------------------------------------------------------------------------------- |
| Historical follow-through → selected report                | UI-Wiring | S      | High   | Done; validated enum values and guarded atomic save                                   |
| Service/config status + retry                              | UI-Wiring | S      | High   | Done; handshake does not claim provider/storage health                                |
| Context/public configuration discovery                     | UI-Wiring | S      | High   | Done; one shared configuration load, visible failure                                  |
| R3 shared/groups/email/display/API/weather/fire activation | UI-Wiring | L      | High   | Skipped: current release pause and external verification                              |
| Operator status/coverage/config review dashboard           | UI-Wiring | L      | Med    | Skipped: authenticated operational interface absent                                   |
| Ingestion/delivery operations dashboard                    | UI-Wiring | L      | Med    | Skipped: privileged operations, outside deadline scope                                |
| Cloud backup/restore/archive export UI                     | UI-Wiring | L      | Med    | Skipped: privileged storage and recovery workflow                                     |
| Membership/revocation/erasure administration UI            | UI-Wiring | L      | High   | Skipped: access/deletion controls need separate review                                |
| Evaluation/benchmark results UI                            | UI-Wiring | L      | Low    | Skipped: needs a read API and verified input/report                                   |
| Sign-in callback/config retry                              | Bug       | S      | High   | Done in existing gated workspace UI                                                   |
| Dismiss/Undo focus recovery                                | UI-UX     | S      | High   | Done; stable heading receives focus                                                   |
| Direct tool shortcuts                                      | UI-UX     | S      | High   | Done; forms remain mounted and retain drafts                                          |
| Glass styling, contrast/fallbacks/mobile                   | UI-UX     | M      | High   | Done; tokens, reusable selectors, system fonts, reduced effects                       |
| Email loading/empty/refresh feedback                       | UI-UX     | S      | Med    | Done in existing gated notification UI                                                |
| Historical audit reconciliation                            | Bug       | S      | Med    | Done; original findings retained below                                                |
| Complete Hindi/identity label coverage                     | UI-Wiring | L      | Med    | Skipped: core/new controls translated; legacy/provider/workspace text remains partial |
| Date-exclusion calendar                                    | Feature   | L      | Med    | Skipped: new constraint workflow rather than a missing wire                           |
| Compact provenance strip/extra feasible-window strip       | UI-UX     | M      | Low    | Skipped: current cards/chart/comparison are usable                                    |
| Automatic corrupt-data repair                              | UI-Wiring | L      | Med    | Skipped: no safe repair function exists; original-byte export is usable               |
| Low-end-device performance/state refactor                  | UI-UX     | L      | Low    | Skipped: no large refactor under deadline                                             |
| Dark theme                                                 | UI-UX     | M      | Low    | Skipped: app has no existing dark theme                                               |

## Rechecked earlier audits

The original numbered descriptions and old line references are historical, not evidence that the defect still exists. Source checks were matched to existing acceptance/regression tests and the browser evidence below.

| WEBPAGE_AUDIT finding | Current result/evidence                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–6                   | Implemented earlier: place-scoped frozen records, material-change assessment, independent retrieval age, lifecycle reopening, atomic saves, chosen-window reassessment. `decision-integrity`, `decision-state`, `r0-decision-save` tests. |
| 7                     | Fixed earlier: loading/queued/unavailable/observations-only are distinguished by NextActionCard and evidence presentation.                                                                                                                |
| 8–10                  | Fixed earlier: fixed activities cannot reschedule; select is a draft; explicit re-record; unresolved versus recorded counts use shared activity models.                                                                                   |
| 11                    | History/filter/reports existed; historical follow-through was still missing and is wired in this pass. Replaced/reopened records remain read-only.                                                                                        |
| 12–15                 | Fixed earlier: selected record summaries, frozen export context, accepted-window filtering, unchecked current indoor confirmation.                                                                                                        |
| 16                    | Still open on inspection: callback ran before config retention. Fixed now: retain config before callback; distinct loading/retry path. Authenticated live callback remains externally gated.                                              |
| 17–18                 | Implemented earlier: committed-save/failed-refresh recovery and session/request generation guards; preserved.                                                                                                                             |
| 19                    | Implemented in R3: selected eligible records, submitted/approved state, duplicate/conflict handling; currently paused.                                                                                                                    |
| 20                    | Reopen/supersede lifecycle implemented in R3. A separate request-changes identity directory is outside this deadline; do not claim that broader workflow.                                                                                 |
| 21–23                 | Fixed earlier: explicit record button, field-specific validation/focus, discard focus/recovery/native dialogs.                                                                                                                            |
| 24                    | Dismiss/Undo focus gap was still present; now focuses a stable active-view or inbox heading.                                                                                                                                              |
| 25                    | Fixed earlier: isolated chart samples have persistent circle markers and gaps remain visible.                                                                                                                                             |
| 26–28                 | Next action, explicit templates/setup and original/chosen comparisons exist. Added direct tool discovery; preserved warnings and comparison limits.                                                                                       |
| 29–30                 | Partial: global/core Hindi and readable choice/status labels exist; some provider, legacy and workspace copy/raw audit identity remains. Full localization/identity directory deferred.                                                   |
| 31                    | Backup import/export, raw recovery, scoped reset and retention copy exist. Selective journal deletion/automatic corrupt repair are not promised.                                                                                          |
| 32–33                 | Fixed earlier: system fonts, nested response contracts, AppErrorBoundary/MapBoundary and recovery UI. Glass typography also uses installed system fonts.                                                                                  |
| 34                    | Shared activity models avoid repeated alternatives; broad state refactor/physical low-end benchmark remains deferred.                                                                                                                     |
| 35                    | Versioned IndexedDB compare-and-write, external-tab notification/conflict reload and recovery are implemented; regression/acceptance coverage retained.                                                                                   |

`DESIGN_AUDIT.md`: all twenty code remedies remain present (date/setup, truthful missing/freshness states, separate search errors, typography/contrast, native dialogs/search controls, accessible chart/rule/window, location explanation, field validation, honest saves, Undo and target sizes). The original browser-permission rejection is historical; the latest user has authorized browser checks. This pass is a focused rendered check, not a complete accessibility certification.

`FRONTEND_UX_IMPLEMENTATION.md`: UX01–11, 13–15, 17–19, 23, 25, 28–30 and 36 have active UI. UX27 now includes historical follow-through. UX20/22/24/26/31 have R3 code/UI but current gates are paused. UX12/16/21/32/33/35 remain bounded polish/constraints/localization/recovery/theme limitations above. UX34 is deferred R5 scope.

## Verification

- Production UI build and lint: pass; no lint warnings after deriving capability flags directly.
- Full existing suite: 431/431 pass. Older R3 fixtures now explicitly select synthetic Full scope; default R0R2 production gates are unchanged. Offline startup validation follows the build-manifest dependency graph rather than assuming a bundled stylesheet name.
- Browser review used isolated synthetic localhost data, no providers/AWS/real user records. Checked widths 1280, 390 and 320 pixels; the inspected home/tool, settings, report and evidence layouts did not widen the document. Checked native decision/plan dialogs, decision → selected History report, historical follow-through persistence after reload, plan save/Undo, stable focus after message/inbox dismissal, two-click Connections shortcut and blocked-network error → successful retry. These are focused checks, not an exhaustive browser matrix.
- Verified both normal glass (16px desktop/12px narrow blur, 14% white surface) and the solid reduced-transparency fallback. Restored temporary browser viewport/media/network overrides after testing. Core ink/muted/forest/accent colors have minimum calculated contrast of 8.57/4.85/6.58/5.33:1 respectively against the declared background palette. The dark next-action panel retains a bright action-button surface; do not apply the ordinary translucent button fill there. These calculations are not a claim about every composite pixel or complete WCAG conformance.
- Screenshots: [desktop tool drawer](artifacts/submission-desktop.png), [mobile connection status](artifacts/submission-mobile.png). Both contain explicitly synthetic QA evidence and were captured from the production build. Earlier offline-cached test shells were excluded by testing the current build on a fresh origin/uncached QA navigation.
- External limits: AWS/auth/SES/provider deployment, verified redistribution, FIRMS credentials/product, physical browsers/phones, screen readers and full localization remain unverified. R4/R5 were not resumed.
