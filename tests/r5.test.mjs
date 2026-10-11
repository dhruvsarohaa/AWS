import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore } from '../api/store.mjs'
import {
  createDeviceService,
  r5Capabilities,
  validateDeviceTelemetry,
  deviceEvidenceState,
} from '../api/r5-devices.mjs'
import { readR5Devices, r5CurrentIndoor } from '../src/lib/r5-devices.ts'

// Isolated state-contract fixtures; no device adapter or actual actuation exists here.
const START = Date.parse('2026-10-10T08:00:00Z')
const owner = { workspaceId: 'workspace_one', sub: 'owner_one', role: 'owner' }
const reviewer = {
  workspaceId: 'workspace_one',
  sub: 'reviewer_one',
  role: 'reviewer',
}
const outsider = {
  workspaceId: 'workspace_two',
  sub: 'owner_two',
  role: 'owner',
}
const profile = (overrides = {}) => ({
  id: 'fixture_profile',
  workspaceId: owner.workspaceId,
  authorizedOwnerSub: owner.sub,
  kind: 'purifier',
  name: 'Isolated fixture profile',
  source: 'Fixture indoor source',
  gatewayId: 'gateway_one',
  deviceIds: ['device_one'],
  pollutants: ['pm25', 'pm10'],
  maxAgeSeconds: 300,
  credentialVersion: 1,
  hardwareValidated: true,
  ownerAuthorized: true,
  validationReference: 'Isolated test signoff; no hardware support claim',
  validatedAt: '2026-10-09T08:00:00Z',
  validUntil: '2026-11-09T08:00:00Z',
  disconnectionPolicy:
    'Retain owner-defined local behavior; cloud does not infer an off command.',
  requiredInterlocks: [],
  manualControlValidated: true,
  operatingPolicyId: 'fixture_policy',
  minimumCycleSeconds: 60,
  automationValidated: true,
  ...overrides,
})
async function fixture(overrides = {}, outdoor = null) {
  let now = START
  const store = new MemoryStore(),
    p = profile(overrides)
  for (const member of [owner, reviewer, outsider])
    await store.put('MEMBERS', member.sub, {
      workspaceId: member.workspaceId,
      role: member.role,
    })
  const service = createDeviceService({
    store,
    profiles: [p],
    clock: () => now,
    outdoorForDevice: async () => outdoor,
  })
  const enrolled = await service.route(
    'POST',
    '/api/workspace/devices',
    {
      version: 0,
      profileId: p.id,
      id: 'device_one',
      name: 'Fixture room',
      placement: {
        room: 'Room one',
        note: 'Placement uncertainty retained',
        installedAt: '2026-10-01T08:00:00Z',
      },
      calibration: {
        at: '2026-10-01T08:00:00Z',
        method: 'Fixture calibration',
        reference: 'Fixture reference',
      },
    },
    owner,
  )
  const gateway = {
    authenticated: true,
    workspaceId: owner.workspaceId,
    gatewayId: p.gatewayId,
    deviceIds: ['device_one'],
    credentialVersion: 1,
  }
  const telemetry = (overrides = {}) => ({
    schemaVersion: 1,
    deviceId: 'device_one',
    source: p.source,
    origin: 'live',
    sequence: 1,
    measuredAt: new Date(now).toISOString(),
    observedStateAt: new Date(now).toISOString(),
    observedState: 'off',
    readings: [
      { pollutant: 'pm25', value: 50, unit: 'µg/m³', statistic: 'instant' },
    ],
    qualityFlags: [],
    interlocks: p.requiredInterlocks.map((id) => ({
      id,
      satisfied: true,
      checkedAt: new Date(now).toISOString(),
      validUntil: new Date(now + 300000).toISOString(),
    })),
    ...overrides,
  })
  const read = async () =>
    (await service.route('GET', '/api/workspace/devices', {}, owner)).devices[0]
  const ingest = (v = {}) => service.gateway('telemetry', telemetry(v), gateway)
  const command = async (v = {}, member = owner) => {
    const current = await read()
    return service.route(
      'POST',
      '/api/workspace/devices/device_one/commands',
      {
        version: current.version,
        commandId: 'command_one',
        action: 'on',
        expiresAt: new Date(now + 60000).toISOString(),
        expectedTelemetrySequence: current.telemetry?.sequence,
        operatingPolicyId: p.operatingPolicyId,
        confirmedPolicy: true,
        ...v,
      },
      member,
    )
  }
  return {
    store,
    p,
    service,
    gateway,
    enrolled,
    telemetry,
    read,
    ingest,
    command,
    now: () => now,
    advance: (ms) => {
      now += ms
    },
  }
}
test('R5 missing, unverified, expired and incomplete profiles leave all capabilities off', () => {
  const off = {
    indoorDevices: false,
    deviceControls: false,
    deviceAutomation: false,
    siteControls: false,
  }
  assert.deepEqual(r5Capabilities([], START), off)
  for (const changes of [
    { hardwareValidated: false },
    { workspaceId: '' },
    { validUntil: '2026-10-09T00:00:00Z' },
    { manualControlValidated: false },
  ])
    assert.deepEqual(r5Capabilities([profile(changes)], START), off)
  assert.equal(r5Capabilities([profile()], START).deviceControls, true)
})
test('R5 default service denies device operations without a hardware profile', async () => {
  const store = new MemoryStore()
  await store.put('MEMBERS', owner.sub, {
    workspaceId: owner.workspaceId,
    role: owner.role,
  })
  await assert.rejects(
    createDeviceService({ store }).route(
      'GET',
      '/api/workspace/devices',
      {},
      owner,
    ),
    { status: 503 },
  )
})
test('R5 profiles and enrollment are tenant-bound; another owner cannot discover device IDs', async () => {
  const f = await fixture()
  await assert.rejects(
    f.service.route('GET', '/api/workspace/devices', {}, outsider),
    { status: 503 },
  )
  await assert.rejects(
    f.service.route(
      'POST',
      '/api/workspace/devices',
      { version: 0, profileId: f.p.id, id: 'device_one' },
      outsider,
    ),
    { status: 503 },
  )
  const list = await f.service.route(
    'GET',
    '/api/workspace/devices',
    {},
    reviewer,
  )
  assert.deepEqual(list.profiles, [])
  await assert.rejects(
    f.service.gateway('telemetry', f.telemetry(), {
      ...f.gateway,
      workspaceId: outsider.workspaceId,
    }),
    { status: 404 },
  )
})
test('R5 metadata, scoped device IDs and registry versions are required for enrollment', async () => {
  const f = await fixture()
  await assert.rejects(
    f.service.route(
      'POST',
      '/api/workspace/devices',
      { version: 0, profileId: f.p.id, id: 'invented' },
      owner,
    ),
  )
  assert.equal(f.enrolled.device.telemetry, null)
  assert.equal(f.enrolled.device.evidenceState, 'unavailable')
  assert.equal(f.enrolled.device.outdoor, null)
  assert.equal(
    (await f.service.route('GET', '/api/workspace/devices', {}, owner))
      .registryVersion,
    1,
  )
})
test('R5 telemetry keeps zero and null separate and rejects units, future time, source and sample/replay', async () => {
  const f = await fixture()
  const accepted = validateDeviceTelemetry(
    f.telemetry({
      readings: [
        { pollutant: 'pm25', value: 0, unit: 'µg/m³', statistic: 'instant' },
        { pollutant: 'pm10', value: null, unit: 'µg/m³', statistic: 'instant' },
      ],
    }),
    f.p,
    'device_one',
    START,
  )
  assert.equal(accepted.readings[0].value, 0)
  assert.equal(accepted.readings[1].value, null)
  for (const changes of [
    { origin: 'sample' },
    { origin: 'replay' },
    { source: 'different' },
    { measuredAt: '2026-10-10T09:00:00Z' },
    {
      readings: [
        { pollutant: 'pm25', value: 50, unit: 'ppm', statistic: 'instant' },
      ],
    },
  ])
    assert.throws(() =>
      validateDeviceTelemetry(f.telemetry(changes), f.p, 'device_one', START),
    )
})
test('R5 reading age uses actual mean interval end, not a newly stamped measurement', async () => {
  const f = await fixture(),
    old = new Date(START - 600000).toISOString()
  const t = validateDeviceTelemetry(
    f.telemetry({
      readings: [
        {
          pollutant: 'pm25',
          value: 20,
          unit: 'µg/m³',
          statistic: 'mean',
          period: { start: new Date(START - 900000).toISOString(), end: old },
        },
      ],
    }),
    f.p,
    'device_one',
    START,
  )
  assert.equal(deviceEvidenceState(t, f.p, START), 'stale')
  await f.ingest({ readings: t.readings })
  f.advance(61000)
  await assert.rejects(f.command(), /Fresh verified indoor/)
})
test('R5 initial observed state starts a conservative minimum cycle interval', async () => {
  const f = await fixture()
  await f.ingest()
  await assert.rejects(f.command(), /minimum cycle/)
  f.advance(61000)
  assert.equal((await f.command()).command.status, 'queued')
})
test('R5 missing/null PM2.5, old telemetry and quality flags block manual commands', async () => {
  for (const readings of [
    [{ pollutant: 'pm25', value: null, unit: 'µg/m³', statistic: 'instant' }],
    [{ pollutant: 'pm10', value: 20, unit: 'µg/m³', statistic: 'instant' }],
  ]) {
    const f = await fixture()
    await f.ingest({ readings })
    f.advance(61000)
    await assert.rejects(f.command(), /usable fresh indoor PM2.5/)
  }
  const stale = await fixture()
  await stale.ingest()
  stale.advance(301000)
  await assert.rejects(stale.command(), /Fresh verified indoor/)
  const flagged = await fixture()
  await flagged.ingest({ qualityFlags: ['calibration_due'] })
  flagged.advance(61000)
  await assert.rejects(flagged.command(), /Fresh verified indoor/)
})
test('R5 indoor and outdoor freshness stay independent; malformed outdoor is missing', async () => {
  const outdoor = {
    source: 'Fixture outdoor observation',
    family: 'observation',
    origin: 'live',
    pollutant: 'pm25',
    value: 0,
    unit: 'µg/m³',
    statistic: 'instant',
    validAt: '2026-10-10T07:00:00Z',
    retrievedAt: '2026-10-10T08:00:00Z',
    maxAgeSeconds: 300,
    evidenceId: 'outdoor_fixture',
    identity: 'Fixture sensor ID',
    attribution: 'Fixture attribution',
  }
  const f = await fixture({}, outdoor)
  await f.ingest()
  const d = await f.read()
  assert.equal(d.evidenceState, 'current')
  assert.equal(d.outdoor.state, 'stale')
  assert.equal(d.outdoor.value, 0)
  const bad = await fixture({}, { ...outdoor, unit: 'AQI' })
  assert.equal((await bad.read()).outdoor, null)
})
test('R5 duplicate telemetry is idempotent; reordered or changed duplicate data is rejected', async () => {
  const f = await fixture()
  const reading = f.telemetry()
  await f.service.gateway('telemetry', reading, f.gateway)
  assert.deepEqual(await f.service.gateway('telemetry', reading, f.gateway), {
    duplicate: true,
  })
  await assert.rejects(
    f.ingest({
      readings: [
        { pollutant: 'pm25', value: 51, unit: 'µg/m³', statistic: 'instant' },
      ],
    }),
    { status: 409 },
  )
  f.advance(6000)
  await f.ingest({ sequence: 2 })
  await assert.rejects(f.ingest({ sequence: 1 }), { status: 409 })
})
test('R5 owners alone control equipment; revoked membership and wrong gateway scope fail closed', async () => {
  const f = await fixture()
  await f.ingest()
  f.advance(61000)
  await assert.rejects(f.command({}, reviewer), { status: 403 })
  await assert.rejects(
    f.service.gateway(
      'claim',
      { deviceId: 'device_one' },
      { ...f.gateway, deviceIds: [] },
    ),
    { status: 401 },
  )
  await f.store.delete('MEMBERS', owner.sub)
  await assert.rejects(f.command(), {
    status: 403,
    code: 'workspace_membership_revoked',
  })
})
test('R5 commands have bounded expiry, expected versions/evidence and explicit policy confirmation', async () => {
  const f = await fixture()
  await f.ingest()
  f.advance(61000)
  for (const changes of [
    { expiresAt: new Date(f.now() - 1).toISOString() },
    { expiresAt: new Date(f.now() + 121000).toISOString() },
    { version: 1 },
    { expectedTelemetrySequence: 2 },
    { confirmedPolicy: false },
    { operatingPolicyId: 'other' },
  ])
    await assert.rejects(f.command(changes))
  assert.deepEqual((await f.read()).commands, [])
})
test('R5 same command retry does not enqueue twice and different use of its ID is rejected', async () => {
  const f = await fixture()
  await f.ingest()
  f.advance(61000)
  const first = await f.command(),
    retry = await f.command()
  assert.equal(first.duplicate, false)
  assert.equal(retry.duplicate, true)
  assert.equal((await f.read()).commands.length, 1)
  await assert.rejects(f.command({ action: 'off' }), { status: 409 })
})
test('R5 gateway claim dispatches once; acceptance remains separate from observed change', async () => {
  const f = await fixture()
  await f.ingest()
  f.advance(61000)
  await f.command()
  const claimed = await f.service.gateway(
    'claim',
    { deviceId: 'device_one' },
    f.gateway,
  )
  assert.equal(claimed.command.status, 'dispatched')
  assert.equal(
    (await f.service.gateway('claim', { deviceId: 'device_one' }, f.gateway))
      .command,
    null,
  )
  await f.service.gateway(
    'acknowledge',
    { deviceId: 'device_one', commandId: 'command_one', outcome: 'accepted' },
    f.gateway,
  )
  assert.equal((await f.read()).commands[0].status, 'acknowledged')
  assert.equal((await f.read()).telemetry.observedState, 'off')
  f.advance(6000)
  await f.ingest({
    sequence: 2,
    observedState: 'on',
    appliedCommandId: 'command_one',
  })
  assert.equal((await f.read()).commands[0].status, 'observed')
  assert.ok((await f.read()).commands[0].observedAt)
})
test('R5 queued commands expire; dispatched uncertainty is not blindly resent or treated as off', async () => {
  const expired = await fixture()
  await expired.ingest()
  expired.advance(61000)
  await expired.command()
  expired.advance(61000)
  assert.equal((await expired.read()).commands[0].status, 'expired')
  assert.equal(
    (
      await expired.service.gateway(
        'claim',
        { deviceId: 'device_one' },
        expired.gateway,
      )
    ).command,
    null,
  )
  const uncertain = await fixture()
  await uncertain.ingest()
  uncertain.advance(61000)
  await uncertain.command()
  await uncertain.service.gateway(
    'claim',
    { deviceId: 'device_one' },
    uncertain.gateway,
  )
  uncertain.advance(61000)
  assert.equal((await uncertain.read()).commands[0].status, 'unknown')
  assert.equal((await uncertain.read()).telemetry.observedState, 'off')
  await assert.rejects(
    uncertain.command({ commandId: 'command_two' }),
    /pending or uncertain/,
  )
})
test('R5 changed evidence and revoked actor suppress queued gateway work', async () => {
  const changed = await fixture()
  await changed.ingest()
  changed.advance(61000)
  await changed.command()
  changed.advance(6000)
  await changed.ingest({ sequence: 2 })
  assert.equal(
    (
      await changed.service.gateway(
        'claim',
        { deviceId: 'device_one' },
        changed.gateway,
      )
    ).suppressed,
    true,
  )
  const revoked = await fixture()
  await revoked.ingest()
  revoked.advance(61000)
  await revoked.command()
  await revoked.store.delete('MEMBERS', owner.sub)
  assert.equal(
    (
      await revoked.service.gateway(
        'claim',
        { deviceId: 'device_one' },
        revoked.gateway,
      )
    ).suppressed,
    true,
  )
})
test('R5 membership change between validation and transaction prevents enqueue atomically', async () => {
  const f = await fixture()
  await f.ingest()
  f.advance(61000)
  const original = f.store.transaction.bind(f.store)
  f.store.transaction = async (writes) => {
    await f.store.put('MEMBERS', owner.sub, {
      workspaceId: outsider.workspaceId,
      role: 'owner',
    })
    return original(writes)
  }
  await assert.rejects(f.command(), { status: 409 })
  const row = await f.store.get('R5DEVICE#workspace_one#device_one')
  assert.deepEqual(row.data.commands, [])
})
test('R5 membership change between validation and transaction prevents gateway claim', async () => {
  const f = await fixture()
  await f.ingest()
  f.advance(61000)
  await f.command()
  const original = f.store.transaction.bind(f.store)
  f.store.transaction = async (writes) => {
    await f.store.delete('MEMBERS', owner.sub)
    return original(writes)
  }
  await assert.rejects(
    f.service.gateway('claim', { deviceId: 'device_one' }, f.gateway),
    { status: 409 },
  )
  assert.equal(
    (await f.store.get('R5DEVICE#workspace_one#device_one')).data.commands[0]
      .status,
    'queued',
  )
})
test('R5 device revocation disables credentials, automation and queued work', async () => {
  const f = await fixture()
  await f.ingest()
  f.advance(61000)
  await f.command()
  const d = await f.read()
  await f.service.route(
    'POST',
    '/api/workspace/devices/device_one/revoke',
    { version: d.version, confirmed: true },
    owner,
  )
  const revoked = await f.read()
  assert.equal(revoked.revoked, true)
  assert.equal(revoked.commands[0].status, 'suppressed')
  assert.equal(revoked.controlsAvailable, false)
  await assert.rejects(f.ingest({ sequence: 2 }), { status: 403 })
})
test('R5 automation requires consent, distinct thresholds, separate override release and fresh compatible PM', async () => {
  const f = await fixture()
  await f.ingest()
  f.advance(61000)
  let d = await f.read()
  const policy = {
    version: d.version,
    policyId: 'policy_one',
    enabled: true,
    explicitConsent: true,
    startThreshold: 50,
    stopThreshold: 25,
    minimumCycleSeconds: 60,
  }
  await assert.rejects(
    f.service.route(
      'PUT',
      '/api/workspace/devices/device_one/policy',
      { ...policy, stopThreshold: 50 },
      owner,
    ),
  )
  await f.service.route(
    'PUT',
    '/api/workspace/devices/device_one/policy',
    policy,
    owner,
  )
  assert.equal(
    (await f.service.evaluateAutomation(owner.workspaceId, 'device_one'))
      .reason,
    'disabled_or_override',
  )
  d = await f.read()
  await f.service.route(
    'PUT',
    '/api/workspace/devices/device_one/override',
    { version: d.version, active: false, explicitConsent: true },
    owner,
  )
  const evaluated = await f.service.evaluateAutomation(
    owner.workspaceId,
    'device_one',
  )
  assert.equal(evaluated.queued, true)
  assert.equal(evaluated.command.rule, 'policy_one')
  d = await f.read()
  await f.service.route(
    'PUT',
    '/api/workspace/devices/device_one/override',
    { version: d.version, active: true, explicitConsent: true },
    owner,
  )
  assert.equal((await f.read()).commands[0].status, 'suppressed')
})
test('R5 automation hysteresis holds inside the band and stale evidence starts no new decision', async () => {
  const f = await fixture()
  await f.ingest({
    readings: [
      { pollutant: 'pm25', value: 30, unit: 'µg/m³', statistic: 'instant' },
    ],
  })
  f.advance(61000)
  let d = await f.read()
  await f.service.route(
    'PUT',
    '/api/workspace/devices/device_one/policy',
    {
      version: d.version,
      policyId: 'policy_one',
      enabled: true,
      explicitConsent: true,
      startThreshold: 50,
      stopThreshold: 25,
      minimumCycleSeconds: 60,
    },
    owner,
  )
  d = await f.read()
  await f.service.route(
    'PUT',
    '/api/workspace/devices/device_one/override',
    { version: d.version, active: false, explicitConsent: true },
    owner,
  )
  assert.equal(
    (await f.service.evaluateAutomation(owner.workspaceId, 'device_one'))
      .reason,
    'hysteresis_hold',
  )
  f.advance(301000)
  assert.equal(
    (await f.service.evaluateAutomation(owner.workspaceId, 'device_one'))
      .reason,
    'indoor_not_current',
  )
})
test('R5 site controls need reviewed interlocks; absent, failed or expired interlocks block commands', async () => {
  assert.equal(
    r5Capabilities(
      [
        profile({
          kind: 'dust_suppression',
          sitePilotValidated: true,
          operatorApproval: true,
          requiredInterlocks: [],
        }),
      ],
      START,
    ).siteControls,
    false,
  )
  for (const interlocks of [
    [],
    [
      {
        id: 'water_ready',
        satisfied: false,
        checkedAt: new Date(START).toISOString(),
        validUntil: new Date(START + 300000).toISOString(),
      },
    ],
  ]) {
    const f = await fixture({
      kind: 'dust_suppression',
      sitePilotValidated: true,
      operatorApproval: true,
      requiredInterlocks: ['water_ready'],
    })
    await f.ingest({ interlocks })
    f.advance(61000)
    await assert.rejects(f.command(), /interlocks/)
  }
})
test('R5 ventilation excludes forecast/sample outdoor context and enforces validated limits and time alignment', async () => {
  const p = {
    kind: 'ventilation',
    sitePilotValidated: true,
    operatorApproval: true,
    requiredInterlocks: ['operator_present'],
    requiresOutdoor: true,
    outdoorMaximumPm25: 35,
    minimumIndoorOutdoorDifference: 10,
  }
  const base = {
    source: 'Fixture outdoor',
    family: 'observation',
    origin: 'live',
    pollutant: 'pm25',
    value: 20,
    unit: 'µg/m³',
    statistic: 'instant',
    validAt: new Date(START).toISOString(),
    retrievedAt: new Date(START).toISOString(),
    maxAgeSeconds: 300,
    evidenceId: 'evidence_one',
    identity: 'sensor_outside',
    attribution: 'Fixture only',
  }
  for (const changes of [
    { family: 'model_forecast' },
    { origin: 'sample' },
    { value: 45 },
    { validAt: new Date(START - 120000).toISOString() },
  ]) {
    const f = await fixture(p, { ...base, ...changes })
    await f.ingest()
    f.advance(61000)
    await assert.rejects(f.command())
  }
  const valid = await fixture(p, base)
  await valid.ingest()
  valid.advance(61000)
  assert.equal((await valid.command()).command.status, 'queued')
})
test('R5 private client contract rejects malformed readings and ages retained data honestly', async () => {
  const f = await fixture()
  await f.ingest()
  const response = await f.service.route(
      'GET',
      '/api/workspace/devices',
      {},
      owner,
    ),
    parsed = readR5Devices(response)
  assert.equal(r5CurrentIndoor(parsed.devices[0], START), true)
  assert.equal(r5CurrentIndoor(parsed.devices[0], START + 301000), false)
  assert.throws(() =>
    readR5Devices({
      ...response,
      devices: [{ ...response.devices[0], workspaceId: 'other' }],
    }),
  )
  const bad = structuredClone(response)
  bad.devices[0].telemetry.readings[0].unit = 'AQI'
  assert.throws(() => readR5Devices(bad))
})
test('R5 unknown command outcomes stay blocking beyond ordinary history retention', async () => {
  const f = await fixture()
  await f.ingest()
  f.advance(61000)
  await f.command()
  await f.service.gateway('claim', { deviceId: 'device_one' }, f.gateway)
  f.advance(8 * 86400000)
  assert.equal((await f.read()).commands[0].status, 'unknown')
  await f.ingest({ sequence: 2 })
  f.advance(61000)
  await assert.rejects(
    f.command({ commandId: 'command_two' }),
    /pending or uncertain/,
  )
  const d = await f.read()
  await f.service.route(
    'POST',
    '/api/workspace/devices/device_one/reconcile',
    {
      version: d.version,
      commandId: 'command_one',
      confirmedPhysicalCheck: true,
    },
    owner,
  )
  assert.equal(
    (await f.store.get('R5DEVICE#workspace_one#device_one')).data.commands[0]
      .status,
    'reconciled',
  )
  assert.deepEqual((await f.read()).commands, [])
})
test('R5 credential rotation binds only a higher reviewed epoch and clears automatic work/evidence', async () => {
  const f = await fixture()
  await f.ingest()
  let d = await f.read()
  await assert.rejects(
    f.service.route(
      'POST',
      '/api/workspace/devices/device_one/rotate',
      { version: d.version, confirmed: true },
      owner,
    ),
  )
  f.p.credentialVersion = 3
  d = await f.read()
  assert.equal(d.credentialRotationAvailable, true)
  await f.service.route(
    'POST',
    '/api/workspace/devices/device_one/rotate',
    { version: d.version, confirmed: true },
    owner,
  )
  d = await f.read()
  assert.equal(d.telemetry, null)
  assert.equal(d.lastCycleAt, null)
  assert.equal(d.manualOverride.active, true)
  await assert.rejects(f.ingest({ sequence: 2 }), { status: 403 })
  assert.equal(
    (
      await f.service.gateway('telemetry', f.telemetry(), {
        ...f.gateway,
        credentialVersion: 3,
      })
    ).accepted,
    true,
  )
})
test('R5 mutation budget is bounded and expired local budget/receipt rows compact without table scans', async () => {
  const f = await fixture()
  await f.ingest()
  f.advance(61000)
  await f.command()
  for (let i = 0; i < 19; i++) {
    const d = await f.read()
    await f.service.route(
      'PUT',
      '/api/workspace/devices/device_one/override',
      { version: d.version, active: true, explicitConsent: true },
      owner,
    )
  }
  const d = await f.read()
  await assert.rejects(
    f.service.route(
      'PUT',
      '/api/workspace/devices/device_one/override',
      { version: d.version, active: true, explicitConsent: true },
      owner,
    ),
    { status: 429 },
  )
  const originalBudget = await f.store.get(
    'R5BUDGET#workspace_one#device_one#2026-10-10',
  )
  assert.equal(originalBudget.data.count, 20)
  f.advance(31 * 86400000)
  f.p.validUntil = '2026-12-10T08:00:00Z'
  await f.ingest({ sequence: 2 })
  assert.equal(
    await f.store.get('R5BUDGET#workspace_one#device_one#2026-10-10'),
    null,
  )
  assert.equal(
    await f.store.get('R5RECEIPT#workspace_one#device_one', 'command_one'),
    null,
  )
  const row = await f.store.get('R5DEVICE#workspace_one#device_one')
  assert.equal(row.data.receipts.length, 0)
})
test('R5 outdoor resolver failures do not erase usable indoor evidence', async () => {
  const f = await fixture()
  await f.ingest()
  const service = createDeviceService({
    store: f.store,
    profiles: [f.p],
    clock: f.now,
    outdoorForDevice: async () => {
      throw new Error('Fixture outage')
    },
  })
  const response = await service.route(
    'GET',
    '/api/workspace/devices',
    {},
    owner,
  )
  assert.equal(response.devices[0].outdoorRefreshFailed, true)
  assert.equal(response.devices[0].evidenceState, 'current')
  assert.equal(response.devices[0].telemetry.readings[0].value, 50)
})
