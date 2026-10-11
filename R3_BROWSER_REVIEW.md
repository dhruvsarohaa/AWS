# R3 rendered browser review

Completed **10 October 2026, Asia/Kolkata**, using the Codex in-app browser with the user's browser-check permission. R3 scope: F15, F14, F06, F13, F22, F23 and F24.

## Environments

- **Normal local app, `127.0.0.1:5174`:** existing API and default integration gates. Confirmed a searched Delhi location, then created the explicitly named `R3 browser review · Delhi` favorite and `R3 browser review group · edited` local group. These local QA records were retained. No GPS permission or real account was used.
- **Isolated production-build review, `127.0.0.1:5175`:** [tests/browser-review-server.mjs](tests/browser-review-server.mjs) serves `dist` with a visible synthetic-data banner and an in-memory store. Its fixture controls initialize a synthetic session, plan and reviewed records, and simulate failures. It calls the real workspace/group/subscription handlers, provider validators, public projection and widget renderer. It loads no `.env`, strips cloud queue/storage/secret references, performs no provider requests and sends no email. Its synthetic bearer token does **not** validate Cognito authentication. No production feature flag or account configuration was changed.

The initial sandbox server could not accept the browser connection. Running the localhost servers through the approved process escalation resolved that networking restriction. The browser URL policy was respected. Temporary viewport emulation was reset, and both review servers were stopped after verification.

## Verified rendered flows

| Area                             | Observed result                                                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F14 local groups                 | Disabled creation before a favorite exists; create, edit, reload persistence and grouped-site selection pass.                                                                                                                     |
| F15 selected records             | Three independently reviewed activities appear in the selector. Selecting the earlier record submits that specific activity.                                                                                                      |
| F15 approval                     | The original 08:00–09:00 window has a synthetic peak of 100; approval records the chosen 10:00–11:00 window's peak of 30 with complete coverage and the rule of 75.                                                               |
| F15 lifecycle                    | Follow-through, reopening with a reason, a freshly reviewed local replacement, frozen predecessor history and approval of the active replacement pass. Superseded records have no approval control.                               |
| F15 save/refresh recovery        | A committed save followed by a simulated failed GET shows the saved/refresh warning and locks workspace mutations. Reload restores the committed version and re-enables editing.                                                  |
| F15 revocation                   | A coded membership-revoked response clears private reasons, groups, subscription controls and workspace mutation controls, and shows the sign-in/revocation message.                                                              |
| F06 subscription                 | Enable stays disabled before explicit consent. Material-change alerts plus daily brief save the selected synthetic plan/coarse area. Consent resets after save.                                                                   |
| F06 unsubscribe                  | A missing token disables confirmation. Visiting a signed link keeps the in-memory subscription enabled; only explicit confirmation disables it. The confirmation page requires no signed-in session. No message was sent.         |
| F13 disabled gate                | Normal local display shows redistribution is disabled/unreviewed, with no private app navigation or planning controls.                                                                                                            |
| F13 enabled display              | Synthetic public forecast, independent observation, measured zero, retrieval age and attribution render. A failed refresh labels and retains the last snapshot and original retrieval time.                                       |
| F22 widget                       | The actual static renderer displays the literal script-like station name as text; the DOM contains zero scripts. Snapshot and reload limitations render.                                                                          |
| F23 weather                      | Units, UTC-to-IST times, grid, rainfall zero versus missing dash, cooler/drier ranking and attribution render. Old weather withholds suggestions. Failed refresh retains the original evidence and explicitly labels failure.     |
| F24 fires                        | Explicit map loading renders two validated synthetic detections and the acquisition table. A valid empty response shows no detections with the absence-of-fire limitation. A failed refresh retains the earlier data.             |
| Responsive/language smoke checks | App/context, public display and widget document width equals a 390-pixel emulated viewport. Weather/fire tables scroll inside their containers. Hindi context/navigation labels render. Desktop rendering was visually inspected. |

Time inputs were checked using native keyboard increments and the live chosen-window preview before saving; the automation tool's `fill` operation did not update React state for these native time fields. This was a test-control limitation, not a product repair.

## Browser findings repaired

1. Context HTTP failures previously displayed the retained response's `available` status. Both panels now show **Refresh failed**, an alert explaining retained data, and the original retrieval timestamp. The weather panel also exposes its returned grid and UTC/IST interpretation.
2. A superseded pending proposal still displayed **Approve decision** even though the server rejected approval. The control now appears only for an active pending proposal. Rebuilt-browser verification found exactly one approval button before approving the active replacement.

After the changes, TypeScript/frontend/PWA production build and lint pass. The complete offline suite passes **166/166**; the final lifecycle-control repair was also verified in the rebuilt browser. Previous API/infrastructure/SAM results remain recorded in [RELEASE_STATUS.md](RELEASE_STATUS.md).

## Saved evidence

- [Local group creation/editing](artifacts/r3-browser/local-groups.jpg)
- [Disabled public route](artifacts/r3-browser/public-disabled.jpg)
- [Saved mutation / refresh failure](artifacts/r3-browser/workspace-save-recovery.jpg)
- [Replacement proposal and approval](artifacts/r3-browser/workspace-replacement-fixture.jpg)
- [Membership revocation](artifacts/r3-browser/workspace-revoked-fixture.jpg)
- [Confirmed synthetic unsubscribe](artifacts/r3-browser/unsubscribe-confirmed-fixture.jpg)
- [Public refresh retention at mobile width](artifacts/r3-browser/public-retained-mobile-fixture.jpg)
- [Explicit satellite map](artifacts/r3-browser/fire-map-fixture.jpg)
- [Repaired context failure message](artifacts/r3-browser/context-outage-fixed-fixture.jpg)

To repeat the isolated review, run `pnpm build`, then `node tests/browser-review-server.mjs`, and open `http://127.0.0.1:5175/qa`. The fixture server binds only to loopback and loses server state when stopped. Its initialization button replaces only this fixture origin's local test plan. It is excluded from production imports/builds.

## Remaining external verification

Actual Cognito login, two deployed organizations/DynamoDB concurrency, real SES acceptance/delivery/feedback, licensed public redistribution and production CORS/frame behavior, authenticated FIRMS and live weather coverage still require deployment/provider setup. Physical devices, screen-reader/high-zoom/full keyboard accessibility, full Hindi coverage, install/offline/reconnect and measured deployed load/restore remain release checks. This review is local UI evidence and synthetic integration evidence; it is not a live cloud/provider or accessibility certification.
