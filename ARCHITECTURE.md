# Airday implementation architecture

**R2 extension (9 October 2026):** planning schema 2 includes five local coarse favorites and bounded private assessment feedback, with revision-checked migration and recovery. Public evidence history uses bounded partition/range queries over prospective run catalogs and separate sensor-hour rows; no table scans or fabricated archived forecasts. Additional pollutant envelopes preserve PM compatibility. Production builds include an allowlisted static offline shell; public coarse evidence is in a separate five-entry IndexedDB cache, and private API/auth/tiles are excluded. Full details and external gates: [IMPLEMENTATION_R2.md](IMPLEMENTATION_R2.md).

Implemented 8 October 2026. Cloud resources are defined and SAM-validated, not deployed yet.

## Evidence path

1. The browser chooses an Indian place or permission-based device coordinates. The server validates numeric bounds and planning dates. Exact device coordinates are used transiently for station distances; ingestion demand retains a rounded 0.1° area.
2. `api/engine.mjs` renews bounded demand and schedules due refreshes using a conditional lease. Cached data is returned immediately with explicit source and coverage states. Queue outages preserve reads and expose a scheduling warning.
3. EventBridge Scheduler runs the dispatcher every five minutes. SQS buffers refreshes, with two ingestion workers, partial batch failure handling and a dead-letter queue. Local development uses a serial background processor and the same engine.
4. Adapters preserve unit, quantity, source time, statistic, measurement period, identity and provenance. Forecast, monitor and archive failures are handled separately. No synthetic measurements enter the live path.
5. Forecast aliases are deduplicated using the model's returned grid identity after discovery. OpenAQ metadata, latest values and flag lookups are shared by station. A tile index checks nine adjacent half-degree tiles and computes actual great-circle distances for returned candidates.
6. History jobs overlap 48 hours, preserve revisions, retain first retrieval time and persist pagination cursors. Jobs bound provider calls/records, continue incomplete pages later and avoid repeatedly loading completed sensor windows. License-reviewed observation archives are optional; forecasts are archived prospectively.
7. Public evidence snapshots identify the rounded area, date, jurisdiction labels, forecast content, original observations and policy version. Forecast records are retained separately for audit/evaluation. Snapshot hashes are evidence identifiers, not access credentials.

## Planning and trust

The deterministic rule compares the maximum available hourly PM2.5 model value in the original activity window with the user's review threshold. Partial coverage cannot establish a below-rule result. PM10 never substitutes for missing PM2.5. The 75 example threshold is illustrative, not a health limit.

Flexible alternatives keep duration, require complete forecasts and stay within allowed hours. Users can explicitly record an indoor option, shorter window or cancellation with a reason. Indoor forecasts and ventilation/purifier claims are not inferred from outdoor values.

The editor freezes the evidence, plan, place and date being reviewed. Records retain reason, rule, snapshot, original/chosen windows and their separate assessments, guidance status/version and a reviewed-place fingerprint with coarse 0.1° coordinates. The local fingerprint distinguishes selected coordinates without retaining those exact coordinates in the journal; it is not a security credential or an anonymity guarantee. Legacy records without this provenance remain history and require a new review.

Chooser state, summary eligibility and submission eligibility derive from the same journal. Recorded, reopened and superseded states preserve earlier actions without keeping them active. A schema-version-3 browser document replaces the earlier separate choice/journal keys with one atomic write. Failed writes leave complete session-only state; unreadable canonical content is preserved, blocks replacement and exposes recovery feedback. Concurrent browser-tab conflict handling remains a separate audit backlog item.

Local review and cloud approval share the assessment and material-change functions. Threshold crossings in either direction, coverage/availability changes, freshness degradation and significant peak changes are evaluated for the chosen window. Local review also checks location, plan and guidance date/version/status. Records needing review remain inspectable but cannot be used for a current summary or new local submission until reviewed again. Summaries are fixed English/Hindi templates, with user-written names/reasons unchanged and both original/chosen peaks labelled. They are not official orders or automatically sent messages.

Policies are manual reviewed records, not an LLM interpretation or an AQI-triggered invocation. Empty, irrelevant, revoked, stale and schedule-only records cannot appear as current reviewed orders. GPS lookups without a verified jurisdiction may have no applicable document. Users still check issuing authorities and local directions.

## Shared organizations

- Guest mode keeps plans in the browser. Cloud accounts are optional and administrator-provisioned.
- Cognito authorization-code flow uses PKCE, state checks, no client secret and short access-token sessions. Provider keys never enter the frontend.
- Abort signals and request/session generations discard responses after local sign-out, expiry, a newer operation or component unmount. Sign-out remains enabled while a request is outstanding; a server mutation already accepted before sign-out may still complete.
- The API verifies issuer/client/token use through `aws-jwt-verify`, then resolves organization and role from server membership on each request.
- Owners/approvers save shared plans and approve proposals; reviewers propose and record follow-through. Every partition derives from trusted membership.
- Shared decisions must reference a server-held snapshot and an activity in the shared plan. The normalized locally reviewed plan version must match; times are validated again on the server. Plan/policy changes, material forecast changes, coverage loss and stale forecast evidence invalidate pending approval. Approvers see the reason, windows, threshold and evidence before choosing.
- Plan/proposal/approval/follow-through/preference writes and their audit rows commit atomically through DynamoDB transactions. Optimistic versions reject stale overwrites. The Timeline index supplies recent decisions; it is eventually consistent, so a just-written list can briefly need Reload.
- Preferences have a separate partition, preventing a preference change from overwriting membership/roles.
- SES requires verified membership email, explicit opt-in and a committed approval. A daily 50-email budget and delivery leases bound sends. SES cannot guarantee exactly-once delivery; uncertain delivery is recorded and not automatically retried.

## Storage and retention

| Records                                            | Storage / behavior                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| Public source caches and indexed stations          | DynamoDB, seven-day TTL; source timestamps are preserved              |
| Active demand and station admission                | One-day expiry, explicitly checked even before DynamoDB TTL removal   |
| Model grid cache                                   | Returned-grid identity with one-hour refresh                          |
| Forecast evidence / reconciled history / snapshots | 90-day TTL; no exact user GPS                                         |
| Raw prospectively archived forecasts               | Private versioned S3, SSE, HTTPS-only bucket policy, 90-day lifecycle |
| Shared plans, decisions, audit and membership      | Durable until an operator applies organization retention/erasure      |
| Local equivalents                                  | Atomic file-backed evidence, gzip archives, browser local storage     |

DynamoDB has encryption and point-in-time recovery. Source archives have restricted IAM access. Restore uses a new table, validates schema/indices/TTL and selects it through the `RestoredEvidenceTable` parameter. Original tables, archives, secrets and user pools are retained on stack deletion; deliberate cleanup and backup retention are operator responsibilities.

## Security and capacity

API Gateway REST has throttling and a regional WAF ACL. There is no public Lambda Function URL. The API bounds inputs/body sizes, restricts upstream HTTPS hosts, rejects redirects, enforces timeouts/response limits and returns redacted errors. Amplify receives CSP, HSTS, frame restrictions, permissions policy and no-referrer headers. CloudWatch logs contain event/provider/status, not tokens, keys or GPS query strings; WAF request sampling is disabled.

Secrets Manager stores one server-only provider credential document. API geocoding and ingestion receive only required resource permissions; all DynamoDB permissions are scoped to the application table. This is not a substitute for a deployed IAM and penetration review.

Internal minute/hour/day counters cover retries and all adapter routes. 429 reset headers trigger cooldown. Defaults cap 20 active areas and 20 OpenAQ stations; first-time anonymous demand is admitted within that pilot capacity. Expanding geographic demand requires abuse controls, source quota/licensing review and measured load. The architecture scales shared reads independently of provider polling, but the default rollout is intentionally bounded.

## Evaluation and external release gates

`api/evaluation.mjs` uses prospectively retrieved model archives and period-labelled observations. It approximates a period mean by integrating linear interpolation of instantaneous model samples. Retrospectively retrieved forecasts, incompatible records and missing intervals are excluded. Results separate chronological training/holdout data, report bias/MAE/RMSE and threshold misses, and identify lead time **since retrieval**, not model issue. An experimental bounded bias offset remains research-only and is never applied to the app.

Actual accuracy across Indian cities/seasons requires weeks of paired evidence, station metadata review and independent validation. Interviews, calibrated campus sensors, indoor monitoring, current official directions and deployed restore/security/usability checks require real people, documents, devices or accounts. The software provides the workflow and tools; it does not fabricate those findings.
