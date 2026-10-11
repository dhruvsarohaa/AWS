# Airday UI and UX audit

**11 October 2026 submission review:** the twenty code remedies below remain present. Browser permission has since been granted; the earlier rejection describes the original audit only. The current rendered check, glass styling, feature coverage, remaining limitations and verification are recorded in [SUBMISSION_UI_AUDIT.md](SUBMISSION_UI_AUDIT.md). Physical-device and screen-reader acceptance remains open.

Audit and repair date: 8 October 2026. Scope: React dashboard, forecast chart, location selection, source states, plan editor, persistence feedback, and responsive styles.

This is a source-based audit. Browser inspection of `http://localhost:5174/` was rejected by a saved user permission. No browser workaround was attempted. Findings below are supported by code and, for contrast, calculations from the declared colors. Rendered spacing, zoom behavior, screen-reader behavior, and physical-device interaction still need a visual and interaction pass. This is not a security audit or a claim of WCAG conformance.

Priority: **P1** = address before sharing the pilot; **P2** = next usability improvement. A recommendation is distinct from an observed implementation defect.

## Implementation status

**All 20 findings have code changes implemented.** The table below records the remedy for each original finding. The original evidence and line numbers further below describe the dashboard before these repairs; they are retained as the audit history and are not current source references.

| # | Implemented remedy | Main implementation |
| --- | --- | --- |
| 1 | The date and place lead into the review summary before the timetable and chart. A direct action focuses the first flagged or incomplete activity. | `src/App.tsx`: decision summary and activity focus; `src/App.css`: dashboard order |
| 2 | Delhi is an unconfirmed preview. Example activities have Preview labels; personal review summaries require both a confirmed place and a configured plan. | `src/lib/planner.ts`: defaults and `summarizeActivities`; `src/App.tsx`: setup states |
| 3 | Today, Tomorrow, and available forecast dates update every planning view together. Finished windows are labelled and excluded from upcoming review counts. | `src/App.tsx`: date toolbar; `src/lib/planner.ts`: India dates and `assessActivity` |
| 4 | The editor offers an illustrative example rule or a custom threshold, explains PM2.5 and units, and shows the 80-versus-75 comparison. Below-rule values do not claim safety. | `src/components/PlanEditor.tsx`: review-rule settings; `src/App.tsx`: rule explanation |
| 5 | Each day has 24 normalized hourly slots. Activity coverage distinguishes complete, partial, and missing PM2.5; partial high readings retain their warning. PM10-only results cannot produce a reassuring PM2.5 summary. | `src/lib/planner.ts`: `pointsForDate`, `assessActivity`, and `summarizeActivities` |
| 6 | Source retrieval and observation timestamps remain visible. Ages update every 30 seconds; visible pages refresh every five minutes and older resumed pages refresh. Failed or old forecasts use Last available wording. | `src/App.tsx`: refresh and clock effects; `src/lib/planner.ts`: timestamp helpers |
| 7 | Search, device location, forgetting a location, and dashboard refresh have separate errors and recovery actions. Closing search cancels pending app updates from search or geolocation. | `src/App.tsx`: independent error states and request cancellation |
| 8 | Shared text/status tokens are darker. The declared normal-text palette has contrast assertions; control outlines and chart strokes were darkened. Actual rendered combinations still require review. | `src/index.css`; `src/App.css`; `tests/design.test.mjs` |
| 9 | Body text is 16 px, secondary data text is 14 px, and chart labels use a responsive viewBox so their rendered scale follows the card width. | `src/index.css`; `src/App.css`; `src/components/ForecastChart.tsx` |
| 10 | A native modal dialog contains focus and makes the background inert. It places and restores focus, handles Escape, locks background scrolling, and protects changed drafts. | `src/components/PlanEditor.tsx`: dialog lifecycle and close handling |
| 11 | Search results are a labelled list of ordinary buttons with normal Tab navigation, ArrowDown from the input, Escape/dismissal, and loading/result announcements. | `src/App.tsx`: location search and result list |
| 12 | A native hour selector and announced values provide keyboard/touch inspection. An expandable table includes every hour, both pollutants, units, source, and missing-value labels. | `src/components/ForecastChart.tsx`: inspector and hourly table |
| 13 | The chart includes a labelled threshold line. An activity action highlights its time window and names it above the plot; the regional model limitations remain visible. | `src/components/ForecastChart.tsx`; `src/App.tsx`: activity highlight |
| 14 | ResizeObserver sizes the full-day SVG to its card. Compact hour ticks fit smaller widths; the old fixed minimum width and chart scroll container are removed. | `src/components/ForecastChart.tsx`; `src/App.css`: chart and mobile rules |
| 15 | Unknown device positions are called Approximate device location. Expandable details label accuracy, capture time, coordinates, and model resolution; Change place is available. | `src/App.tsx`: location display and details |
| 16 | Text beside the location button explains permission, API/provider transmission, browser retention, and the absence of continuous tracking. Forget saved location handles removal success or failure explicitly. | `src/App.tsx`: location-use text and `forgetLocation`; `src/lib/storage.ts` |
| 17 | Invalid fields have linked errors and `aria-invalid`. A summary names the affected activity and links to each field; submission focuses the first invalid input or day group. | `src/components/PlanEditor.tsx`; `src/lib/planner.ts`: `validatePlan` |
| 18 | Storage writes return success. Location, plan, and decisions distinguish browser persistence from session-only changes, announce results, and expose Retry saving after failure. | `src/lib/storage.ts`; `src/App.tsx`: persistence and feedback |
| 19 | Removing an activity has Undo without discarding other edits. Changed drafts require Keep editing or Discard changes. Undo plan save restores the preceding saved plan. | `src/components/PlanEditor.tsx`; `src/App.tsx`: plan recovery |
| 20 | Buttons, close controls, dates, inputs, selects, summaries, and weekday choices have at least 44 px target sizing. Focus indicators, a skip link, and reduced-motion handling are included. | `src/App.css`; `src/index.css` |

### Verification completed

- The regression suite passed **22 tests** covering India date boundaries, PM2.5 gaps, PM10-only data, partial windows, rule boundaries, finished windows, timestamp aging, setup gating, failed storage operations, and declared text-color contrast.
- `pnpm run lint` passed with JSX accessibility rules enabled.
- `pnpm run build` passed TypeScript checking and the production Vite build.
- Implementation review checked all 20 mappings above. Unit tests and static accessibility lint do not establish rendered or assistive-technology behavior.

### Rendered checks still required

Browser inspection remains unavailable because the saved permission setting rejected localhost automation. No workaround was used. A browser pass at 320, 375, 768, and 1280 px, 200% zoom, keyboard navigation, and a screen reader is still needed, including long station names and long activity lists. This remaining verification does not mean the code remedies were skipped, and this document makes no claim of full accessibility conformance or enterprise security certification.

## Original twenty findings

### 1. The core decision comes late on phones — P1

Evidence: `src/App.tsx:321` renders the forecast and full timetable before the decision aside at `src/App.tsx:335`; `src/App.css:1186` collapses the layout to one column. The decision heading also uses vague wording such as “A moment to think ahead.” This makes the main action harder to find, especially with many activities.

Upgrade: lead with a compact summary such as “2 outdoor activities need review tomorrow,” with a button that takes the user to the first flagged activity. Follow with the plan, forecast, and monitor context. Keep the date and selected place beside the summary.

Done when: a phone user can find the next action before scrolling through the chart or full schedule. Actual viewport placement needs browser confirmation.

### 2. The first visit evaluates a plan the user did not configure — P1

Evidence: `src/App.tsx:33` defaults to Delhi; `src/App.tsx:36` supplies three activities and a threshold of 75. The rule at `src/App.tsx:274` evaluates these even when `plan.configured` is false. The starter badge is honest, but the prominent decision summary can still read as a personal result.

Upgrade: show “Delhi preview” and an explicit “Set up my plan” entry point. Keep example activity results visibly within the preview until the user confirms their place and plan.

Done when: the app never presents example activities as the user's own review count.

### 3. People cannot plan for today — P2

Evidence: `src/App.tsx:268` fixes the selected date to tomorrow even though the API returns multiple days.

Upgrade: add Today / Tomorrow / date selection within the actual forecast horizon. Clearly distinguish past time slots and unavailable dates.

Done when: the same selected date drives the chart, activities, decisions, and summary, with no date mismatch.

### 4. Choosing a PM2.5 threshold requires unexplained expertise — P1

Evidence: `src/App.tsx:346` offers a number from 1 to 1000; the only context is that it is user chosen. The default 75 has no rationale shown in the UI.

Upgrade: explain what the threshold controls, define PM2.5 in plain language, show a concrete planning example, and make custom editing optional. Do not present an hourly model threshold as an official Indian AQI category or a guarantee of safety.

Done when: a new user can explain why an activity was flagged and understands the rule's limits.

### 5. Incomplete PM2.5 data can produce reassuring summary text — P1

Evidence: `src/App.tsx:278` drops missing values; `src/App.tsx:281` calls an activity missing only when every value is absent. `src/App.tsx:289` accepts PM10 alone as a usable forecast, although decisions depend on PM2.5. The summary can then say “No forecast crossing” despite insufficient PM2.5 coverage.

Upgrade: assess PM2.5 coverage for each activity and date. Give missing or partial coverage its own state, and keep any available high-value warning without implying the rest of the window is clear.

Done when: all-missing and partial PM2.5 windows are labelled incomplete rather than “Below rule.”

### 6. Freshness indicators can contradict retained data — P1

Evidence: `src/App.tsx:322` always says “LIVE FORECAST” when a previous response exists, including after refresh failure. Monitor freshness at `src/App.tsx:287` relies on the previously returned stale flag. Ages do not update while the page stays open, and the display uses the browser response time instead of `forecast.fetchedAt`.

Upgrade: show forecast retrieval time, station observation time, and current age separately. Recompute freshness as time passes, refresh when the page resumes, and use “Last available forecast” after failures. Show the regional model resolution beside its source.

Done when: a retained response never appears newly fetched, and an observation crossing the stale-age threshold changes state without a reload.

### 7. A city-search error looks like a forecast-refresh failure — P1

Evidence: `src/App.tsx:197` stores search failures in the same `error` state used by dashboard refresh; `src/App.tsx:290` treats any error with existing data as `syncFailed`. The banner at `src/App.tsx:319` then says the latest refresh failed even when only the search failed.

Upgrade: use separate errors for search, dashboard refresh, and device location. Put each error beside the relevant action and provide an appropriate retry.

Done when: an unsuccessful search leaves the current forecast's freshness status unchanged and explains the search failure locally.

### 8. Important secondary text has insufficient contrast — P1

Evidence: `src/App.css:1555` uses station metadata color `#939c93` on white (approximately **2.83:1**); `src/App.css:1564` uses provider status color `#929a91` on white (approximately **2.90:1**). These are normal-size text. The W3C AA minimum is 4.5:1 for normal text. Other muted colors should be checked systematically.

Upgrade: introduce a small set of accessible text and status color tokens. Retain the green palette while darkening informative labels and chart text.

Done when: all meaningful normal-size text meets 4.5:1, with separately checked non-text controls and chart marks. Recheck actual rendered backgrounds.

### 9. Data typography remains too small — P1

Evidence: `src/App.css:1632` leaves many metadata labels at 11 px and badges at 10 px. Chart time labels are 9 SVG units at `src/App.css:475`; with the 760-unit viewBox rendered at the mobile minimum of 580 px, this is roughly 6.9 CSS px. `src/App.css:1139` still sets coverage explanation text to 8 px.

Upgrade: use a consistent type scale: approximately 16 px for body text, 14 px for secondary information, and chart labels that stay legible at their rendered size. Give timestamps, units, and warnings the space they need.

Done when: key data is readable without zoom on a phone and in a demo recording. Verify at 200% zoom and with long station names.

### 10. The modal declares accessibility without implementing its keyboard behavior — P1

Evidence: `src/App.tsx:345` adds `role="dialog"` and `aria-modal="true"`, but has no initial-focus handling, focus containment, Escape handling, background inertness, or return-focus logic.

Upgrade: use a native dialog or a well-supported accessible dialog component, with focus placement, contained Tab navigation, Escape handling, focus restoration, and background scroll control.

Done when: keyboard users can open, edit, and close the form without focus escaping to the underlying dashboard.

### 11. City results use incomplete listbox semantics — P1

Evidence: `src/App.tsx:311` assigns listbox/option roles to a collection of buttons without selected-option state or listbox keyboard navigation; the input is not connected to results as a combobox. There is no explicit dismissal behavior.

Upgrade: either implement the full accessible combobox pattern or use a simple labelled list of ordinary buttons. Support Escape dismissal, focus movement, and announcements for loading, result count, and no results.

Done when: keyboard and screen-reader users can find, select, and dismiss results predictably.

### 12. Users cannot inspect exact chart values — P1

Evidence: `src/App.tsx:128` gives the SVG a generic description, but points have no value interaction or numerical alternative. A screen reader receives the chart's purpose, not its data.

Upgrade: add touch and keyboard-accessible point inspection and a collapsible hourly table. Include time, both pollutant values, units, missing values, and source information.

Done when: a user can retrieve the value for a chosen hour without estimating from a line or relying on sight.

### 13. The chart does not explain the planning rule — P2

Evidence: `src/App.tsx:117` accepts forecast points only; the chart has no user threshold or activity-window context. Users must mentally compare three separate areas of the dashboard.

Upgrade: add a labelled “Your review threshold” line and optional selected-activity shading. Explain that the underlying forecast remains regional and has coarser source resolution than the hourly display.

Done when: selecting a flagged activity shows why its time window crossed the user's rule on the chart.

### 14. Mobile chart scrolling hides part of the time range — P2

Evidence: `src/App.css:1665` forces a minimum chart width of 580 px inside a horizontally scrolling container. There is no visible scroll instruction or compact full-day alternative. This is a code-supported usability risk; its exact appearance has not been visually checked.

Upgrade: provide a full-day overview that fits a phone, with an optional detailed view. If horizontal scrolling remains, add a clear affordance and keep units and the time-range context visible.

Done when: users can understand the day's overall trend without discovering an invisible horizontal gesture.

### 15. Device location is technically correct but hard to recognize — P2

Evidence: `src/App.tsx:310` leads with “Device location,” coordinates, and an unlabelled ± accuracy value. Users must interpret GPS notation to know whether the selected place is right.

Upgrade: label the value as “Device location accuracy,” keep coordinates in expandable details, and offer an easy location correction. Add a city/locality name only through a verified lookup; keep “approximate location” when the name is unknown. Explain that device accuracy does not improve forecast spatial resolution.

Done when: users can recognize and correct the location without confusing GPS precision with pollution precision.

### 16. Location retention is not explained before permission — P2

Evidence: `src/App.tsx:208` invokes the browser prompt on click; `src/App.tsx:204` saves the detected coordinates. The retention explanation is in README rather than beside the product control, and there is no “Forget saved location” action.

Upgrade: add brief in-product wording explaining that coordinates are used for the forecast and nearby-station lookup and saved in this browser. Provide a clear saved-location reset.

Done when: users can understand location use before granting permission and can remove the saved device location afterward.

### 17. Form errors do not identify the affected activity or field — P1

Evidence: `src/App.tsx:248` returns one generic error for all activity validation failures; the error is rendered after the whole activity list. Fields have no custom `aria-invalid` or linked error description.

Upgrade: validate each field, display the error beside it, identify the activity by name, and move focus to the first invalid field after submission. Keep form-wide errors for genuinely form-wide problems.

Done when: a user with several activities can fix the precise invalid entry without searching the entire modal.

### 18. Save feedback can claim persistence that failed — P1

Evidence: `src/App.tsx:183` catches localStorage failure without returning a result. `src/App.tsx:249` still closes the editor and marks the plan configured; `src/App.tsx:329` displays “SAVED PLAN.” Decision changes also have no save confirmation.

Upgrade: distinguish “Saved in this browser” from “Updated for this session only.” Return persistence success, announce the result beside the action, and preserve an obvious retry or recovery path.

Done when: a failed storage write never results in an unqualified “Saved” status, while successful saves receive concise feedback.

### 19. Accidental edits have weak recovery — P2

Evidence: `src/App.tsx:348` removes an activity from the draft immediately. Close and Cancel at `src/App.tsx:345` and `src/App.tsx:350` discard edits without a dirty-state notice or recovery. Cancel can restore an unsaved removal by abandoning the entire draft, but cannot undo just that removal while preserving other edits.

Upgrade: provide Undo for removal and a clear dirty-state handling rule when closing. After save, offer a short undo opportunity where feasible. Keep routine successful saving fast.

Done when: an accidental removal can be recovered without losing unrelated edits, and closing a changed form does not silently lose work.

### 20. Several interactive controls are small for touch use — P2

Evidence: `src/App.css:103` sets the header plan button to 34 × 34 px; `src/App.css:1654` sets the modal close control to 36 × 36 px; weekday labels and Add/Remove controls use small padding without a consistent target size. Main mobile actions are 40 px tall. These measurements do not imply every control fails WCAG's minimum target criterion.

Upgrade: adopt a 44 × 44 px product target for frequently used touch controls, including close, weekday selection, and Add/Remove. Increase hit areas and spacing without making the visual icons oversized.

Done when: actual pointer hit areas and spacing are checked on a phone, including the long plan editor.

## Original recommended implementation order

1. Correct misleading states: findings 2, 5, 6, 7, and 18.
2. Make the main task clear: findings 1, 4, 15, and 17.
3. Fix access and readability: findings 8–12 and 20.
4. Refine planning and recovery: findings 3, 13, 14, 16, and 19.

Follow the repairs with a browser pass at 320, 375, 768, and 1280 px; keyboard-only navigation; 200% zoom; and a screen-reader pass. Cover first visit, forecast only, stale monitor, failed refresh, failed search, location denial, partial PM2.5 values, storage failure, and a long activity list. The code repairs and source checks above are complete; these browser checks remain unperformed.

## Accessibility references

- [W3C contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): 4.5:1 for normal text.
- [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): keyboard containment, initial focus, Escape, and return focus.
- [W3C combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): connected popup state and keyboard interaction.

The initial audit changed no application behavior. The subsequent repair pass implements the 20 remedies recorded above.
