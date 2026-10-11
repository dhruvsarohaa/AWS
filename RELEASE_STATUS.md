# Implementation and release evidence

Updated: **10 October 2026, Asia/Kolkata**. This file distinguishes current local acceptance from historical implementation checks and external launch verification.

**Current scope and evidence, 10 October 2026:** R0/R1 local acceptance is the active review; R2 acceptance follows, R3 is paused, R4/R5 are deferred and AWS deployment is last. The scoped suite passed **186/186 tests: 81 new acceptance cases plus 105 existing regressions**. Production frontend/PWA and API builds passed; full lint and the one-page Hindi PDF re-export passed. Native browser migration/recovery, two-tab conflict rejection, injected failed/unavailable storage, backup confirmation/cancellation/reload, finder/timeline/template/alert/Hindi/private-export workflows and source-health failure states were exercised on an isolated synthetic QA origin. A 390-pixel viewport had no horizontal overflow. Detailed commands and limits: [R0_R1_ACCEPTANCE.md](R0_R1_ACCEPTANCE.md); active phase ledger: [R0_R2_RELEASE_STATUS.md](R0_R2_RELEASE_STATUS.md).

**Current live evidence:** local Delhi forecast returned HTTP 200 with 72 hourly points; authenticated OpenAQ returned one reading dated 7 October, correctly stale. Fresh multi-city monitor coverage, other browsers/physical devices, full accessibility, production install/offline behavior and AWS deployment remain unverified. These are functional checks of the listed local workflows, not an enterprise certification. Earlier results below are historical records and do not change the active scope or establish the entire current release's acceptance.

**Historical 9 October frontend update:** R1 and the first UX bundle were integrated; see [IMPLEMENTATION_R1.md](IMPLEMENTATION_R1.md) and [FRONTEND_UX_IMPLEMENTATION.md](FRONTEND_UX_IMPLEMENTATION.md). Production build/lint passed then; no new tests were run in that initial frontend update. The current 10 October scoped acceptance above supersedes that verification limit. The 120-check baseline and scoped R3 review below remain dated historical evidence.

## Historical implementation records, 8–10 October

**R3 implementation update, 9 October:** F15 shared per-record proposals/reopening/replacements, F14 local/shared groups, F06 opted-in review email/daily briefs, F13 separate public display, F22 bounded public JSON/widget, F23 independent weather context and F24 bounded FIRMS satellite-fire map are integrated. See [IMPLEMENTATION_R3.md](IMPLEMENTATION_R3.md) for configuration and limits. Optional integrations default off; no deployment, real email or live R3 provider verification was performed.

**Historical R3 verification (phase now paused):** the full offline suite passes **166/166 tests**, including 44 focused R3 cases and two added membership-revocation/session cases. Production frontend/PWA and API builds, TypeScript, lint, infrastructure/configuration contracts, source credential-pattern scan, deployment-script syntax and SAM `validate --lint` pass. Tests used a writable workspace temporary directory for Windows file-storage checks. **10 October:** authorized local rendered review completed for default gates and isolated synthetic enabled flows, including 390-pixel layouts, lifecycle/replacement/recovery, opt-in/unsubscribe, public display/widget and context retention. It repaired context failure labels and approval buttons on superseded proposals; final rebuilt-browser, build and lint checks pass. See [R3_BROWSER_REVIEW.md](R3_BROWSER_REVIEW.md) for screenshots and boundaries. Actual Cognito/DynamoDB/SES concurrency and feedback, provider credentials/coverage/licensing, cloud recovery and measured deployed capacity remain open. Advanced workspace/email/public integration controls currently use English; full English/Hindi accessibility, physical-device and install/offline/reconnect checks remain open.

**R2 implementation update, 9 October:** maps/favorites, retained evidence history, recaps, concentration-time estimates, pollutant/period views, private feedback/progress and the production offline shell are integrated. See [IMPLEMENTATION_R2.md](IMPLEMENTATION_R2.md). Build/lint/API compilation evidence is separate from rendered behavior, provider coverage, install/offline browser checks and AWS deployment. No R2 tests were added or run; the older 120-check baseline below is not an R2 regression result.

| Real-world issue                                 | Implementation                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Plan outdoor activities around pollution         | Recurrence, user thresholds, constrained alternatives, reasoned decisions, follow-through and summaries                         |
| Regional forecast is not a campus measurement    | Concentration-only display, explicit model/grid/source-step labels, independent station cards and prospective evaluation        |
| Stale/missing/distant monitors                   | Source timestamps, distance, periods/provenance/flags, partial coverage and independently degraded sources                      |
| Provider disagreement                            | Reviewed identity registry, exact period/statistic/unit matching, shared-origin detection; no averaging unlike observations     |
| PM concentration vs official AQI/orders          | No Indian AQI calculation, ambiguous CPCB values gated, manual policy review and revocation/age checks                          |
| Decisions need responsibility and follow-through | Browser journal, optional role-based proposals/approvals, atomic audit records, opt-in delivery                                 |
| Uneven India coverage and reliability            | India search, explicit returned coverage, shared caching, bounded queued ingestion, budgets/cooldowns, operator coverage export |

## Historical baseline checks, 8 October

- **120 automated checks pass** for contracts, units/timezone/dates, incomplete coverage, stale data, quota/queue/provider behavior, resumable history reconciliation, planning, storage, roles/isolation, reviewed-plan matching, material-change approval gates and email delivery semantics. This includes regressions for location-scoped decisions, threshold crossings, chosen-window evidence, atomic failed saves/reload, reopening, retained provider failures and sign-out during outstanding responses. Fixtures are explicitly synthetic and excluded from production. The latest complete run used a writable workspace temporary directory after Windows sandbox rename restrictions affected two file-store checks.
- An isolated local operator drill restored corrupt evidence storage from a fixture backup, preserved the original bytes, and refused mutation while an API writer was active. Cloud restore is still unverified.
- TypeScript and production React build pass; API bundles build; lint passes.
- SAM `validate --lint` and infrastructure/configuration contract checks pass.
- Dependency audit reports no known vulnerabilities. Source credential-pattern scan is part of the release gate; this does not certify zero vulnerabilities.
- Live Delhi lookup returned **72** real hourly forecast points, with server retrieval time `2026-10-08T13:59:34.934Z`, and created a gzip prospective archive. Station state was **not configured**, policy state **verification needed**. No sample observations were inserted.
- A local cached API run made **100 requests paced at 10/second**, with **0 failures**, p50 **9.29 ms**, p95 **13.23 ms**. This is a local measurement and is not an AWS latency/SLA claim.
- Deployment PowerShell parses successfully. Its cloud calls have not run.

The source dependency/contract checks and fixtures can miss issues. Deployed integration and actual device usability remain required.

Webpage audit findings **1–6 and 18** now have source repairs and offline regression evidence; see `WEBPAGE_AUDIT.md`. Other audit phases remain outstanding. This phase did not contact live providers, perform browser inspection or deploy AWS resources.

## Open launch gates

1. **AWS sign-in and provisioning:** deploy the validated stack, verify its public HTTPS URL, CORS/CSP/WAF behavior, alarm subscriptions, IAM permissions and actual costs.
2. **Real observation coverage:** authenticated OpenAQ retrieval now works, but the returned 7 October observation is stale. Verify current station identity, unit, period/flags, freshness and representative coverage in the intended launch areas; neither mocks nor successful authentication establish that coverage.
3. **Optional CPCB connection:** official contract metadata and a key; otherwise keep it explicitly disabled/unverified.
4. **Paused institutional accounts/delivery:** R3's Cognito/organization/role/approval/SES checks remain historical future gates; they are outside the active R0/R1/R2 local acceptance scope.
5. **Operational restore and release ownership:** a real cloud restore drill, log/alarm review, organization retention/support process and measured deployed load within declared capacity.
6. **Device/accessibility usability:** broader physical-phone/high-zoom/screen-reader and R2 production install/offline/reconnect review remain open. Current R0/R1 browser workflow, specific keyboard/focus, Hindi and 390-pixel checks are recorded in R0_R1_ACCEPTANCE.md. Historical R3 rendering stays separately recorded in R3_BROWSER_REVIEW.md.
7. **Real-world validation:** current authority documents, source licensing, paired prospective accuracy evidence, user interviews and any maintained local-sensor pilot.

The software and deployment workflow are implemented. These external gates prevent claiming an already-deployed, universally accurate, vulnerability-free enterprise service.
