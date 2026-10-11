# R5 integration interfaces

Root-owned shared wiring imports `createDeviceService` / `r5Capabilities` from `api/r5-devices.mjs`. Instantiate a runtime service with `{ store, profiles: [] }`. Merge `r5Capabilities([])` into nonsecret config capabilities: `indoorDevices`, `deviceControls`, `deviceAutomation`, `siteControls` are all false.

After existing server membership authentication, route `/api/workspace/devices…` to `devices.route(method, fullPath, parsedBody, trustedMember)`. The service rechecks `MEMBERS` and uses the store's conditional `expectedData` membership check for owner commits/claim. Preserve the existing body bounds, request guards, no-store headers and authentication failure code. There is no new public device endpoint.

Lazy-mount `src/components/R5DevicesPanel.tsx` in Settings with `{ enabled: capabilities.indoorDevices === true, language, active }`. The panel owns calls through existing `workspaceRequest`, subscribes to `onSessionStart` and `onSessionEnd`, and validates responses using `src/lib/r5-devices.ts`. It is absent when disabled/signed out/inactive. After a successful change followed by failed read-back, controls remain locked with “Saved; refreshing failed” and an explicit reload action.

## Browser routes

| Route                             | Request / behavior                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/workspace/devices`      | Membership, registry version, maximum ten private devices, tenant-filtered owner enrollment profiles                                                      |
| POST `/api/workspace/devices`     | Owner; registry `version`, existing `profileId` / allowed physical `id`, `name`, placement `{room,note,installedAt}`, calibration `{at,method,reference}` |
| GET `/api/workspace/devices/<id>` | Tenant-scoped current private projection                                                                                                                  |
| POST `…/<id>/commands`            | Owner; `version`, unique `commandId`, `action:on/off`, `expiresAt`, `expectedTelemetrySequence`, `operatingPolicyId`, `confirmedPolicy:true`              |
| PUT `…/<id>/policy`               | Validated purifier-automation profile only; `version`, `policyId`, explicit consent, enabled, start/stop thresholds, minimum cycle seconds                |
| PUT `…/<id>/override`             | Owner; `version`, `active`, `explicitConsent:true`; enabling suppresses queued automatic work                                                             |
| POST `…/<id>/revoke`              | Owner; `version`, `confirmed:true`; no physical command inferred                                                                                          |
| POST `…/<id>/rotate`              | Owner; `version`, `confirmed:true`; requires operator-provisioned higher reviewed credential epoch                                                        |
| POST `…/<id>/reconcile`           | Owner; `version`, unknown `commandId`, `confirmedPhysicalCheck:true`; fresh observed state after expiry required                                          |

## Trusted future seams — currently not exposed

`service.gateway(operation, body, identity)` supports telemetry, claim and acknowledge. `identity` must come from a selected real verifier, with authenticated tenant/gateway/device scope and credential epoch; browser body flags cannot become such an identity. Telemetry payloads use schema 1, identity/source/live provenance, sequence, separate UTC measurement/observed-state times, bounded pollutant readings/quality flags/interlocks. Claim returns a command at most once; the future gateway must enforce expiry, expected state, allowlist and durable physical execution deduplication. Acknowledge `{deviceId,commandId,outcome:'accepted'|'rejected'}` remains separate from command-correlated observed telemetry.

`service.evaluateAutomation(workspaceId, deviceId)` performs one bounded purifier decision; it is not scheduled. `outdoorForDevice(deviceId,workspaceId)` is a trusted optional resolver, not a browser URL. Its reviewed envelope requires source, observation/model family, live/sample/replay provenance, PM2.5 µg/m³, statistic, value/null, valid/retrieval time, maximum age, evidence ID, identity and attribution. Missing resolver returns no outdoor reading.

Reviewed profiles are deployment-owned objects, not environment JSON supplied by users. Their required fields and stricter purifier/automation/site gates are defined in `validatedDeviceProfiles`. Do not install fixture profiles from tests into runtime. Actual protocol support, secret handling, scheduler/adapter wiring, operating-policy approval and field verification remain separate hardware-pilot work.
