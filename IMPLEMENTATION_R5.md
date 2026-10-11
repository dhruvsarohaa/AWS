# R5 device foundations — 10 October 2026

R5's private device contracts, bounded state lifecycle and conditional interface are implemented in the order **F28 → F29 → F32**. **Actual device support, physical control, operating-policy validation and the site pilot remain pending.** No hardware, gateway protocol or supported vendor was selected. Production uses an empty reviewed-profile list: device capabilities are off, no empty device panel appears, and no gateway endpoint, physical adapter or automation scheduler is exposed.

The state-contract tests use isolated in-memory fixtures. They establish software behavior, not genuine indoor readings, working credentials or equipment actuation. No AWS deployment or live command was performed.

## F28 — Private indoor/outdoor evidence

`api/r5-devices.mjs` owns a workspace-bound registry limited to ten physical device IDs from server-reviewed profiles. Profiles require tenant and optional owner binding, an allowlisted gateway/device identity, provider identity, validation reference/time/expiry, explicit hardware and owner authorization, calibration/placement metadata and a documented disconnection policy. Missing, incomplete or expired profiles disable access. A browser cannot create a profile or supply an upstream address.

Gateway telemetry is a separate trusted integration seam. It requires a verified gateway identity scoped to tenant, device IDs and credential epoch. It accepts only live provenance, monotonic sequence numbers, UTC measurement/observation times, PM2.5/PM10 in µg/m³, instant or bounded mean intervals, explicit nulls, quality flags and validated interlocks. Zero remains a valid reading; sample/replay, invented units, future/out-of-order data and conflicting duplicate sequences are rejected. Admission is at most one new telemetry update per five seconds per device.

Indoor measurement age and outdoor evidence age remain separate. Mean-reading freshness uses its actual interval end. Outdoor evidence comes only from a future trusted server resolver and retains source, family, evidence/identity, units/statistic, valid/retrieval time and attribution; missing outdoor data stays missing. An outdoor resolver failure does not erase indoor readings. No indoor/outdoor average, AQI conversion, regulatory-reference claim or estimated indoor value is produced.

The optional English/Hindi panel shows placement and calibration limits, independently dated readings and an accessible table. Sign-out, expiry and membership revocation clear private state; later responses cannot restore it. Server-configured profiles are filtered by tenant and owner before enrollment options are returned.

## F29 — Command lifecycle and conditional automation

Only the current workspace owner can mutate equipment. Enrollment, changes, command enqueue and gateway claim include a conditional check of the full membership grant in the same storage transaction, preventing a revoked or changed grant from silently committing.

Manual commands require an explicit reviewed operating-policy confirmation, a unique ID, expected device revision and telemetry sequence, usable fresh PM2.5, verified observed state, satisfied unexpired interlocks and the minimum cycle interval. Commands expire within two minutes; the panel requests a one-minute expiry. The first observed state conservatively starts the cycle timer. Commands use an on/off allowlist; this does not establish that any real vendor supports it.

The lifecycle distinguishes queued, claimed/dispatched, gateway acknowledged, independently observed, expired, rejected, suppressed and unknown outcomes. A gateway claim returns a command once. API acceptance or a gateway acknowledgment does not assert that equipment changed state. Observation confirmation requires a fresh matching state tied to the command ID after dispatch. Changed evidence/policy, revoked actors or invalid interlocks suppress queued work. A dispatched command with no confirmed outcome becomes unknown and is never automatically retransmitted. Unknown outcomes remain blocking beyond ordinary history retention until an owner confirms a physical check against fresh observed state after expiry.

Manual control enables a separate override. Purifier automation requires a server-validated physical automation pilot, explicit policy consent, distinct start/stop thresholds, a minimum cycle interval and a separately released override. Only fresh compatible instant PM2.5 can trigger a decision. Missing/stale data, the hysteresis band, override, pending/unknown work and cycle limits prevent new decisions. The evaluator is a callable integration seam; no automatic job or physical dispatch is scheduled. Disconnection does not imply an assumed universal off command.

Revocation suppresses queued work, preserves dispatched uncertainty, disables automation and advances the credential epoch. Credential rotation must first be provisioned and verified by an operator in the server profile with a higher epoch; an owner can then bind it. Binding clears old telemetry/cycle knowledge, pauses automation and retains manual override. Browser input cannot select a credential value or provide a token.

## F32 — Site control gates

Ventilation and dust-suppression profiles additionally require a validated site pilot, operator approval and explicit required interlocks. Missing, failed or expired interlocks block commands. Ventilation requires fresh live outdoor observations, compatible instant PM2.5 measurements within one minute, and reviewed outdoor-concentration/indoor-difference limits before requesting on. Regional forecasts, sample/replay data and unsupported or unresolved comparisons cannot authorize ventilation.

These are contracts for a future site policy, not water/electrical/mechanical safety validation. F32 remains outside the consumer/school release until actual sensors, actuators, physical stop/override/disconnection behavior and operating policy have been tested with the operator.

## Bounds and retention

| State                           | Bound / retention                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Registry/current device state   | Ten devices per workspace; one current telemetry record per device                                                        |
| Owner mutations/queued commands | Combined twenty changes per device per UTC day                                                                            |
| Command history                 | Latest fifty; resolved history projected for seven days; unresolved active/unknown outcomes retained until reconciliation |
| Audit                           | Latest fifty events, up to thirty days; identifiers/actions only                                                          |
| Idempotency receipts            | At most six hundred per device; thirty days                                                                               |
| Budget records                  | Two-day expiry; references tracked per device                                                                             |
| Transaction cleanup             | At most twenty expired receipt/budget references per mutation; no table scans                                             |

DynamoDB TTL is accompanied by transactional bounded cleanup so local FileStore records cannot grow indefinitely under active use. Receipt and budget internals are excluded from the client projection. Profiles, telemetry and histories remain private; responses keep the existing authenticated no-store boundary. The pilot must agree registry retention/export/erasure and backup handling before enrollment. No user-facing erase operation is supplied before actual gateway revocation and physical device reuse policy are validated.

## Verification and remaining work

**28 focused checks pass** in `tests/r5.test.mjs`, including tenant/owner isolation, membership revocation races, provenance/unit/null/zero/mean-age validation, cycles, duplicate/expiry/uncertainty handling, independent outdoor failure, credential rotation, local cleanup, thresholds/override and site interlocks. R5 source passes TypeScript and targeted lint without warnings. Root records combined build/suite and browser results separately.

Before enabling a physical pilot, select one documented supported device and owner-controlled outbound TLS gateway; implement scoped credential verification, secure server credential storage and adapter behavior; prove durable gateway deduplication and actual command/observed-state semantics; validate collocation, sensor placement/calibration and disconnection policy; review owner data retention; test physical manual controls first; then explicitly approve any automation/site interlocks. No environment flag alone clears these gates. See `R5_INTEGRATION_NOTES.md` for the current software wiring.
