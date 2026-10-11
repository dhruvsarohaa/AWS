import { ApiError, hash, timestamp } from './core.mjs'

const DAY = 86400000
const id = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v)
const text = (v, max = 160) =>
  typeof v === 'string' && Boolean(v.trim()) && v.length <= max
const number = (v, min, max) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const kinds = ['sensor', 'purifier', 'ventilation', 'dust_suppression']
const activeCommands = ['queued', 'dispatched', 'acknowledged', 'unknown']
const checkedTime = (value, now, maxAge = DAY) => {
  const normalized = timestamp(value)
  if (
    !normalized ||
    Date.parse(normalized) > now + 30000 ||
    now - Date.parse(normalized) > maxAge
  )
    throw new ApiError(
      'Device evidence time is invalid or outside the accepted window.',
    )
  return normalized
}
const devicePk = (workspace, device) => `R5DEVICE#${workspace}#${device}`
const registryPk = (workspace) => `R5REGISTRY#${workspace}`
const safeError = (message, status = 409) => {
  throw new ApiError(message, status)
}

// These profiles come from a reviewed server deployment, never request bodies or browser flags.
export function validatedDeviceProfiles(profiles = [], now = Date.now()) {
  if (!Array.isArray(profiles) || profiles.length > 10) return []
  const seen = new Set()
  return profiles
    .filter((p) => {
      if (
        !p ||
        !id(p.id) ||
        seen.has(p.id) ||
        !id(p.workspaceId) ||
        (p.authorizedOwnerSub !== undefined && !id(p.authorizedOwnerSub)) ||
        !kinds.includes(p.kind) ||
        !text(p.name, 80) ||
        !text(p.source, 120) ||
        !id(p.gatewayId) ||
        !Array.isArray(p.deviceIds) ||
        !p.deviceIds.length ||
        p.deviceIds.length > 10 ||
        !p.deviceIds.every(id) ||
        new Set(p.deviceIds).size !== p.deviceIds.length ||
        !Array.isArray(p.pollutants) ||
        !p.pollutants.length ||
        !p.pollutants.every((v) => ['pm25', 'pm10'].includes(v)) ||
        !number(p.maxAgeSeconds, 30, 3600) ||
        !Number.isSafeInteger(p.credentialVersion) ||
        p.credentialVersion < 1 ||
        p.hardwareValidated !== true ||
        p.ownerAuthorized !== true ||
        !text(p.validationReference, 200) ||
        !timestamp(p.validatedAt) ||
        Date.parse(p.validatedAt) > now ||
        !timestamp(p.validUntil) ||
        Date.parse(p.validUntil) <= now ||
        !text(p.disconnectionPolicy, 300) ||
        !Array.isArray(p.requiredInterlocks) ||
        p.requiredInterlocks.length > 10 ||
        !p.requiredInterlocks.every(id) ||
        new Set(p.requiredInterlocks).size !== p.requiredInterlocks.length
      )
        return false
      if (
        p.kind !== 'sensor' &&
        (p.manualControlValidated !== true ||
          !text(p.operatingPolicyId, 80) ||
          !number(p.minimumCycleSeconds, 60, 3600))
      )
        return false
      if (
        ['ventilation', 'dust_suppression'].includes(p.kind) &&
        (p.sitePilotValidated !== true ||
          p.operatorApproval !== true ||
          !p.requiredInterlocks.length)
      )
        return false
      if (
        p.kind === 'ventilation' &&
        (p.requiresOutdoor !== true ||
          !number(p.outdoorMaximumPm25, 0, 1000) ||
          !number(p.minimumIndoorOutdoorDifference, 0, 1000))
      )
        return false
      seen.add(p.id)
      return true
    })
    .map((p) => structuredClone(p))
}
export function r5Capabilities(profiles = [], now = Date.now()) {
  const valid = validatedDeviceProfiles(profiles, now)
  return {
    indoorDevices: valid.length > 0,
    deviceControls: valid.some((p) => p.kind === 'purifier'),
    deviceAutomation: valid.some(
      (p) => p.kind === 'purifier' && p.automationValidated === true,
    ),
    siteControls: valid.some((p) =>
      ['ventilation', 'dust_suppression'].includes(p.kind),
    ),
  }
}

export function validateDeviceTelemetry(
  body,
  profile,
  deviceId,
  now = Date.now(),
) {
  if (
    !body ||
    body.schemaVersion !== 1 ||
    body.deviceId !== deviceId ||
    body.origin !== 'live' ||
    !Number.isSafeInteger(body.sequence) ||
    body.sequence < 1 ||
    body.source !== profile.source ||
    !Array.isArray(body.readings) ||
    body.readings.length > 2 ||
    !body.readings.length ||
    !['on', 'off', 'unknown'].includes(body.observedState) ||
    !Array.isArray(body.qualityFlags) ||
    body.qualityFlags.length > 8 ||
    !body.qualityFlags.every((flag) =>
      [
        'warmup',
        'calibration_due',
        'sensor_error',
        'placement_changed',
        'unverified',
      ].includes(flag),
    )
  )
    throw new ApiError(
      'Device telemetry identity, source, live provenance or fields are invalid.',
    )
  const measuredAt = checkedTime(body.measuredAt, now)
  const pollutants = new Set()
  const readings = body.readings.map((r) => {
    if (
      !r ||
      !profile.pollutants.includes(r.pollutant) ||
      pollutants.has(r.pollutant) ||
      r.unit !== 'µg/m³' ||
      !['instant', 'mean'].includes(r.statistic) ||
      (r.value !== null && !number(r.value, 0, 5000))
    )
      throw new ApiError(
        'Indoor pollutant, units, statistic or value is invalid.',
      )
    pollutants.add(r.pollutant)
    let period = null
    if (r.statistic === 'mean') {
      const start = checkedTime(r.period?.start, now),
        end = checkedTime(r.period?.end, now)
      if (
        Date.parse(end) <= Date.parse(start) ||
        Date.parse(end) > Date.parse(measuredAt) ||
        Date.parse(end) - Date.parse(start) > 3600000
      )
        throw new ApiError('Indoor measurement interval is invalid.')
      period = { start, end }
    }
    return {
      pollutant: r.pollutant,
      value: r.value,
      unit: 'µg/m³',
      statistic: r.statistic,
      period,
    }
  })
  if (!Array.isArray(body.interlocks) || body.interlocks.length > 10)
    throw new ApiError('Device interlocks are invalid.')
  const interlocks = body.interlocks.map((v) => {
    if (
      !v ||
      !profile.requiredInterlocks.includes(v.id) ||
      typeof v.satisfied !== 'boolean'
    )
      throw new ApiError('Device interlock identity is invalid.')
    const checkedAt = checkedTime(v.checkedAt, now),
      validUntil = timestamp(v.validUntil)
    if (
      !validUntil ||
      Date.parse(validUntil) <= Date.parse(checkedAt) ||
      Date.parse(validUntil) - Date.parse(checkedAt) >
        profile.maxAgeSeconds * 1000
    )
      throw new ApiError('Device interlock validity is invalid.')
    return { id: v.id, satisfied: v.satisfied, checkedAt, validUntil }
  })
  if (new Set(interlocks.map((v) => v.id)).size !== interlocks.length)
    throw new ApiError('Duplicate device interlock.')
  if (
    body.appliedCommandId !== undefined &&
    body.appliedCommandId !== null &&
    !id(body.appliedCommandId)
  )
    throw new ApiError('Observed command identifier is invalid.')
  return {
    schemaVersion: 1,
    deviceId,
    source: profile.source,
    origin: 'live',
    sequence: body.sequence,
    measuredAt,
    retrievedAt: new Date(now).toISOString(),
    readings,
    observedState: body.observedState,
    observedStateAt: checkedTime(body.observedStateAt, now),
    interlocks,
    qualityFlags: [...new Set(body.qualityFlags)],
    appliedCommandId: body.appliedCommandId || null,
  }
}
export function deviceEvidenceState(telemetry, profile, now = Date.now()) {
  if (!telemetry) return 'unavailable'
  if (
    telemetry.origin !== 'live' ||
    telemetry.qualityFlags.length ||
    Date.parse(telemetry.measuredAt) > now ||
    Date.parse(telemetry.observedStateAt) > now
  )
    return 'unverified'
  return now - Date.parse(telemetry.measuredAt) >
    profile.maxAgeSeconds * 1000 ||
    telemetry.readings.some(
      (r) =>
        r.statistic === 'mean' &&
        (Date.parse(r.period.end) > now ||
          now - Date.parse(r.period.end) > profile.maxAgeSeconds * 1000),
    ) ||
    now - Date.parse(telemetry.observedStateAt) > profile.maxAgeSeconds * 1000
    ? 'stale'
    : 'current'
}
function outdoorProjection(value, now) {
  if (
    !value ||
    !text(value.source, 120) ||
    !['observation', 'model_forecast'].includes(value.family) ||
    !['live', 'sample', 'replay'].includes(value.origin) ||
    value.pollutant !== 'pm25' ||
    value.unit !== 'µg/m³' ||
    !['instant', 'mean', 'model_sample'].includes(value.statistic) ||
    !timestamp(value.validAt) ||
    !timestamp(value.retrievedAt) ||
    Date.parse(value.retrievedAt) > now ||
    !text(value.evidenceId, 80) ||
    !text(value.attribution, 300) ||
    !text(value.identity, 120) ||
    !number(value.maxAgeSeconds, 30, 10800) ||
    (value.value !== null && !number(value.value, 0, 5000))
  )
    return null
  const age = now - Date.parse(value.validAt)
  return {
    source: value.source,
    family: value.family,
    origin: value.origin,
    pollutant: value.pollutant,
    value: value.value,
    unit: value.unit,
    statistic: value.statistic,
    validAt: timestamp(value.validAt),
    retrievedAt: timestamp(value.retrievedAt),
    maxAgeSeconds: value.maxAgeSeconds,
    evidenceId: value.evidenceId,
    attribution: value.attribution,
    identity: value.identity,
    state:
      value.origin !== 'live' || age < 0
        ? 'unverified'
        : age > value.maxAgeSeconds * 1000
          ? 'stale'
          : 'current',
  }
}
function expireCommands(state, now) {
  const next = structuredClone(state)
  next.commands = next.commands
    .filter(
      (c) =>
        activeCommands.includes(c.status) ||
        now - Date.parse(c.createdAt) <= 7 * DAY,
    )
    .map((c) =>
      Date.parse(c.expiresAt) <= now &&
      ['queued', 'dispatched', 'acknowledged'].includes(c.status)
        ? { ...c, status: c.status === 'queued' ? 'expired' : 'unknown' }
        : c,
    )
  return next
}
function audit(state, action, actor, now, commandId = null) {
  state.audit = [
    ...state.audit.filter((v) => now - Date.parse(v.at) <= 30 * DAY),
    {
      action,
      actor,
      at: new Date(now).toISOString(),
      ...(commandId ? { commandId } : {}),
    },
  ].slice(-50)
}
function owner(member) {
  if (member?.role !== 'owner')
    throw new ApiError(
      'Only the device workspace owner may change equipment settings.',
      403,
    )
}
function version(body, row) {
  if (!Number.isSafeInteger(body?.version) || body.version !== row.version)
    throw new ApiError(
      'Device evidence or settings changed. Reload before continuing.',
      409,
    )
}
function interlocksReady(telemetry, profile, now) {
  return profile.requiredInterlocks.every((key) => {
    const interlock = telemetry?.interlocks.find((v) => v.id === key)
    return (
      interlock?.satisfied === true &&
      Date.parse(interlock.checkedAt) <= now &&
      Date.parse(interlock.validUntil) > now
    )
  })
}

export function createDeviceService({
  store,
  profiles = [],
  clock = () => Date.now(),
  outdoorForDevice = async () => null,
}) {
  const configured = () => validatedDeviceProfiles(profiles, clock())
  const findProfile = (state) =>
    configured().find(
      (p) =>
        p.id === state.profileId &&
        p.workspaceId === state.workspaceId &&
        p.kind === state.kind &&
        p.source === state.source &&
        (!p.authorizedOwnerSub || p.authorizedOwnerSub === state.ownerSub) &&
        p.deviceIds.includes(state.id),
    )
  const matchesGateway = (state, profile) =>
    profile &&
    !state.revoked &&
    profile.gatewayId === state.gatewayId &&
    profile.credentialVersion === state.gatewayCredentialVersion
  async function trustedMember(member) {
    if (
      !member ||
      !id(member.workspaceId) ||
      !id(member.sub) ||
      !['owner', 'approver', 'reviewer'].includes(member.role)
    )
      throw new ApiError('A trusted workspace membership is required.', 401)
    const saved = await store.get('MEMBERS', member.sub)
    if (
      !saved ||
      saved.data.workspaceId !== member.workspaceId ||
      saved.data.role !== member.role
    )
      throw new ApiError(
        'Workspace membership was revoked. Contact its owner.',
        403,
        'workspace_membership_revoked',
      )
    return saved
  }
  async function readDevice(workspace, deviceId) {
    if (!id(deviceId)) throw new ApiError('Device identifier is invalid.')
    const row = await store.get(devicePk(workspace, deviceId))
    if (!row)
      throw new ApiError('Device is unavailable in this workspace.', 404)
    return row
  }
  async function projection(row) {
    const now = clock(),
      state = expireCommands(row.data, now),
      profile = findProfile(state)
    let outdoor = null,
      outdoorRefreshFailed = false
    try {
      outdoor = outdoorProjection(
        await outdoorForDevice(state.id, state.workspaceId),
        now,
      )
    } catch {
      outdoorRefreshFailed = true
    }
    const {
      receipts: _receipts,
      budgetDays: _budgetDays,
      ...privateView
    } = state
    return {
      ...privateView,
      version: row.version,
      evidenceState: matchesGateway(state, profile)
        ? deviceEvidenceState(state.telemetry, profile, now)
        : 'unverified',
      outdoor,
      outdoorRefreshFailed,
      integrationAvailable: Boolean(matchesGateway(state, profile)),
      controlsAvailable: Boolean(
        matchesGateway(state, profile) && profile.kind !== 'sensor',
      ),
      automationAvailable: Boolean(
        matchesGateway(state, profile) &&
        profile.kind === 'purifier' &&
        profile.automationValidated === true,
      ),
      maxAgeSeconds: profile?.maxAgeSeconds || 30,
      minimumCycleSeconds: profile?.minimumCycleSeconds || null,
      interlocksReady: Boolean(
        profile && interlocksReady(state.telemetry, profile, now),
      ),
      credentialRotationAvailable: Boolean(
        profile && profile.credentialVersion > state.gatewayCredentialVersion,
      ),
      operatingPolicyId: profile?.operatingPolicyId || null,
      disconnectionPolicy: profile?.disconnectionPolicy || null,
    }
  }
  async function write(
    row,
    state,
    budget = false,
    receipt = null,
    grant = null,
  ) {
    const now = clock(),
      writes = [
        { pk: row.pk, sk: 'current', expected: row.version, data: state },
      ]
    state.receipts ||= []
    state.budgetDays ||= []
    // Compact expired references in the same transaction; FileStore does not provide a TTL daemon.
    const expired = [
      ...state.budgetDays
        .filter((v) => v.expireAt <= now / 1000)
        .map((v) => ({ ...v, type: 'budget' })),
      ...state.receipts
        .filter((v) => v.expireAt <= now / 1000)
        .map((v) => ({
          ...v,
          type: 'receipt',
          pk: `R5RECEIPT#${state.workspaceId}#${state.id}`,
          sk: v.id,
        })),
    ].slice(0, 20)
    for (const reference of expired) {
      const old = await store.get(reference.pk, reference.sk || 'current')
      if (old)
        writes.push({
          pk: old.pk,
          sk: old.sk,
          delete: true,
          ...(old.version ? { expected: old.version } : {}),
        })
      if (reference.type === 'budget')
        state.budgetDays = state.budgetDays.filter((v) => v.pk !== reference.pk)
      else state.receipts = state.receipts.filter((v) => v.id !== reference.id)
    }
    if (budget) {
      const pk = `R5BUDGET#${state.workspaceId}#${state.id}#${new Date(now).toISOString().slice(0, 10)}`,
        old = await store.get(pk),
        count = old?.data.count || 0
      if (count >= 20)
        throw new ApiError('The device daily change budget is exhausted.', 429)
      writes.push({
        pk,
        sk: 'current',
        expected: old?.version || 0,
        data: { count: count + 1 },
        extra: { expireAt: Math.ceil((now + 2 * DAY) / 1000) },
      })
      if (!state.budgetDays.some((v) => v.pk === pk))
        state.budgetDays.push({
          pk,
          expireAt: Math.ceil((now + 2 * DAY) / 1000),
        })
    }
    if (receipt) {
      if (state.receipts.length >= 600)
        throw new ApiError(
          'Device receipt retention is full. Wait for the retention window before adding work.',
          429,
        )
      writes.push(receipt)
      state.receipts.push({ id: receipt.sk, expireAt: receipt.extra.expireAt })
    }
    if (grant)
      writes.push({
        pk: 'MEMBERS',
        sk: grant.sk,
        check: true,
        expectedData: grant.data,
      })
    if (!(await store.transaction(writes)))
      throw new ApiError('Device state changed. Reload before continuing.', 409)
    return { ...row, data: state, version: row.version + 1 }
  }
  async function commandReady(state, profile, action, outdoor) {
    const now = clock()
    if (!matchesGateway(state, profile) || profile.kind === 'sensor')
      safeError('Control integration is unavailable.', 503)
    if (
      deviceEvidenceState(state.telemetry, profile, now) !== 'current' ||
      state.telemetry.observedState === 'unknown'
    )
      safeError(
        'Fresh verified indoor evidence and observed equipment state are required.',
      )
    const indoor = state.telemetry.readings.find((r) => r.pollutant === 'pm25')
    if (!indoor || indoor.value === null)
      safeError('A usable fresh indoor PM2.5 reading is required.')
    if (!interlocksReady(state.telemetry, profile, now))
      safeError(
        'Required equipment interlocks are missing, expired or not satisfied.',
      )
    if (
      profile.requiresOutdoor &&
      (!outdoor ||
        outdoor.family !== 'observation' ||
        outdoor.state !== 'current' ||
        outdoor.value === null ||
        outdoor.statistic !== 'instant')
    )
      safeError(
        'This operating policy requires fresh compatible outdoor observation evidence.',
      )
    if (
      profile.kind === 'ventilation' &&
      (indoor.statistic !== 'instant' ||
        Math.abs(
          Date.parse(outdoor.validAt) - Date.parse(state.telemetry.measuredAt),
        ) > 60000 ||
        (action === 'on' &&
          (outdoor.value > profile.outdoorMaximumPm25 ||
            indoor.value - outdoor.value <
              profile.minimumIndoorOutdoorDifference)))
    )
      safeError(
        'Indoor/outdoor evidence does not meet the validated ventilation operating limits.',
      )
    if (state.telemetry.observedState === action)
      safeError('Equipment already reports this state; no command was queued.')
    if (
      state.lastCycleAt &&
      now - Date.parse(state.lastCycleAt) < profile.minimumCycleSeconds * 1000
    )
      safeError('The equipment minimum cycle interval has not elapsed.')
    if (state.commands.some((c) => activeCommands.includes(c.status)))
      safeError(
        'An earlier command is pending or uncertain. Reconcile its observed outcome before another command.',
      )
  }
  async function enqueueCommand(row, body, member, automatic = false) {
    const grant = await trustedMember(member)
    const now = clock(),
      state = expireCommands(row.data, now),
      profile = findProfile(state)
    if (
      !id(body.commandId) ||
      body.commandId.length < 8 ||
      !['on', 'off'].includes(body.action)
    )
      throw new ApiError(
        'Use a unique command ID and an allowlisted on/off action.',
      )
    const fingerprint = hash({
      deviceId: state.id,
      action: body.action,
      actor: member.sub,
      automatic,
      expiresAt: body.expiresAt,
      expectedTelemetrySequence: body.expectedTelemetrySequence,
      operatingPolicyId: body.operatingPolicyId,
    })
    const receiptPk = `R5RECEIPT#${state.workspaceId}#${state.id}`,
      prior = await store.get(receiptPk, body.commandId)
    if (prior && prior.expireAt > now / 1000) {
      if (prior.data.fingerprint !== fingerprint)
        throw new ApiError(
          'Command ID was already used for a different request.',
          409,
        )
      return {
        device: await projection(row),
        command: state.commands.find((c) => c.id === body.commandId) || {
          ...prior.data.command,
          status: 'unknown',
        },
        duplicate: true,
      }
    }
    version(body, row)
    const expiresAt = timestamp(body.expiresAt)
    if (
      !expiresAt ||
      Date.parse(expiresAt) <= now ||
      Date.parse(expiresAt) > now + 120000
    )
      throw new ApiError('Commands must expire within two minutes.')
    if (
      body.operatingPolicyId !== profile?.operatingPolicyId ||
      body.confirmedPolicy !== true
    )
      throw new ApiError(
        'Explicit confirmation of the validated operating policy is required.',
      )
    if (body.expectedTelemetrySequence !== state.telemetry?.sequence)
      throw new ApiError(
        'Observed evidence changed. Reload before issuing a command.',
        409,
      )
    const outdoor = outdoorProjection(
      await outdoorForDevice(state.id, state.workspaceId),
      now,
    )
    await commandReady(state, profile, body.action, outdoor)
    const command = {
      schemaVersion: 1,
      id: body.commandId,
      workspaceId: state.workspaceId,
      deviceId: state.id,
      action: body.action,
      expectedState: state.telemetry.observedState,
      expectedTelemetrySequence: state.telemetry.sequence,
      expectedVersion: row.version,
      actor: member.sub,
      rule: automatic ? state.policy.id : null,
      operatingPolicyId: profile.operatingPolicyId,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      status: 'queued',
      dispatchedAt: null,
      acknowledgedAt: null,
      observedAt: null,
    }
    state.commands = [...state.commands, command].slice(-50)
    if (!automatic)
      state.manualOverride = {
        active: true,
        actor: member.sub,
        at: new Date(now).toISOString(),
      }
    audit(
      state,
      automatic ? 'automatic_command_queued' : 'manual_command_queued',
      member.sub,
      now,
      command.id,
    )
    const saved = await write(
      row,
      state,
      true,
      {
        pk: receiptPk,
        sk: command.id,
        expected: prior?.version || 0,
        data: { fingerprint, command },
        extra: { expireAt: Math.ceil((now + 30 * DAY) / 1000) },
      },
      grant,
    )
    return { device: await projection(saved), command, duplicate: false }
  }
  async function route(method, path, body, member) {
    const grant = await trustedMember(member)
    const tenantProfiles = configured().filter(
      (p) =>
        p.workspaceId === member.workspaceId &&
        (!p.authorizedOwnerSub || p.authorizedOwnerSub === member.sub),
    )
    if (!configured().some((p) => p.workspaceId === member.workspaceId))
      throw new ApiError(
        'Device integration is disabled until a supported hardware pilot is validated.',
        503,
      )
    if (path === '/api/workspace/devices' && method === 'GET') {
      const registry = await store.get(registryPk(member.workspaceId))
      const rows = await Promise.all(
        (registry?.data.ids || []).map((key) =>
          readDevice(member.workspaceId, key),
        ),
      )
      return {
        schemaVersion: 1,
        membership: {
          workspaceId: member.workspaceId,
          role: member.role,
          sub: member.sub,
        },
        devices: await Promise.all(rows.map(projection)),
        registryVersion: registry?.version || 0,
        profiles:
          member.role === 'owner'
            ? tenantProfiles.map((p) => ({
                id: p.id,
                name: p.name,
                kind: p.kind,
                source: p.source,
                deviceIds: p.deviceIds,
              }))
            : [],
      }
    }
    if (path === '/api/workspace/devices' && method === 'POST') {
      owner(member)
      const profile = tenantProfiles.find(
        (p) => p.id === body?.profileId && p.deviceIds.includes(body.id),
      )
      if (
        !profile ||
        !text(body.name, 80) ||
        !text(body.placement?.room, 80) ||
        !text(body.placement?.note, 300) ||
        !timestamp(body.placement?.installedAt) ||
        Date.parse(body.placement.installedAt) > clock() ||
        !timestamp(body.calibration?.at) ||
        Date.parse(body.calibration.at) > clock() ||
        !text(body.calibration?.method, 120) ||
        !text(body.calibration?.reference, 120)
      )
        throw new ApiError(
          'A validated device profile, placement and calibration metadata are required.',
        )
      const pk = registryPk(member.workspaceId),
        registry = await store.get(pk)
      if (
        !Number.isSafeInteger(body.version) ||
        body.version !== (registry?.version || 0)
      )
        throw new ApiError(
          'Device registry changed. Reload before adding a device.',
          409,
        )
      if ((registry?.data.ids || []).length >= 10)
        throw new ApiError('The device pilot is limited to ten devices.', 429)
      const at = new Date(clock()).toISOString(),
        state = {
          schemaVersion: 1,
          id: body.id,
          profileId: profile.id,
          workspaceId: member.workspaceId,
          ownerSub: member.sub,
          kind: profile.kind,
          name: body.name.trim(),
          source: profile.source,
          placement: {
            room: body.placement.room.trim(),
            note: body.placement.note.trim(),
            installedAt: timestamp(body.placement.installedAt),
          },
          calibration: {
            at: timestamp(body.calibration.at),
            method: body.calibration.method.trim(),
            reference: body.calibration.reference.trim(),
          },
          gatewayId: profile.gatewayId,
          gatewayCredentialVersion: profile.credentialVersion,
          revoked: false,
          createdAt: at,
          telemetry: null,
          commands: [],
          audit: [],
          receipts: [],
          budgetDays: [],
          lastCycleAt: null,
          policy: null,
          manualOverride: { active: true, actor: member.sub, at },
        }
      audit(state, 'device_enrolled', member.sub, clock())
      if (
        !(await store.transaction([
          {
            pk,
            sk: 'current',
            expected: registry?.version || 0,
            data: { ids: [...(registry?.data.ids || []), body.id] },
          },
          {
            pk: devicePk(member.workspaceId, body.id),
            sk: 'current',
            expected: 0,
            data: state,
          },
          {
            pk: 'MEMBERS',
            sk: grant.sk,
            check: true,
            expectedData: grant.data,
          },
        ]))
      )
        throw new ApiError(
          'Device registry changed. Reload before adding a device.',
          409,
        )
      return {
        device: await projection({ data: state, version: 1 }),
        registryVersion: body.version + 1,
      }
    }
    const match = path.match(
      /^\/api\/workspace\/devices\/([a-zA-Z0-9_-]{1,80})(?:\/(commands|policy|override|revoke|rotate|reconcile))?$/,
    )
    if (!match) throw new ApiError('Device route is unavailable.', 404)
    const row = await readDevice(member.workspaceId, match[1]),
      action = match[2]
    if (method === 'GET' && !action) return { device: await projection(row) }
    owner(member)
    if (method === 'POST' && action === 'commands')
      return enqueueCommand(row, body, member)
    const state = expireCommands(row.data, clock()),
      profile = findProfile(state)
    version(body, row)
    if (method === 'PUT' && action === 'policy') {
      if (
        profile?.kind !== 'purifier' ||
        profile.automationValidated !== true ||
        state.revoked
      )
        throw new ApiError(
          'Automation is disabled until the purifier operating policy passes a physical pilot.',
          503,
        )
      if (
        !id(body.policyId) ||
        typeof body.enabled !== 'boolean' ||
        body.explicitConsent !== true ||
        !number(body.startThreshold, 1, 1000) ||
        !number(body.stopThreshold, 0, 999) ||
        body.stopThreshold >= body.startThreshold ||
        !number(body.minimumCycleSeconds, profile.minimumCycleSeconds, 3600)
      )
        throw new ApiError(
          'Automation needs explicit consent, separate start/stop thresholds and a validated cycle interval.',
        )
      state.policy = {
        id: body.policyId,
        enabled: body.enabled,
        startThreshold: body.startThreshold,
        stopThreshold: body.stopThreshold,
        minimumCycleSeconds: body.minimumCycleSeconds,
        operatingPolicyId: profile.operatingPolicyId,
        actor: member.sub,
        at: new Date(clock()).toISOString(),
      }
      // Enabling a policy does not clear a manual override or queue equipment work.
      audit(state, 'policy_saved', member.sub, clock())
    } else if (method === 'PUT' && action === 'override') {
      if (typeof body.active !== 'boolean' || body.explicitConsent !== true)
        throw new ApiError('Explicit manual override confirmation is required.')
      state.manualOverride = {
        active: body.active,
        actor: member.sub,
        at: new Date(clock()).toISOString(),
      }
      if (body.active)
        state.commands = state.commands.map((c) =>
          c.status === 'queued' && c.rule ? { ...c, status: 'suppressed' } : c,
        )
      audit(
        state,
        body.active ? 'manual_override_enabled' : 'manual_override_released',
        member.sub,
        clock(),
      )
    } else if (method === 'POST' && action === 'revoke') {
      if (body.confirmed !== true)
        throw new ApiError('Confirm device credential revocation.')
      state.revoked = true
      state.gatewayCredentialVersion++
      if (state.policy) state.policy.enabled = false
      state.manualOverride = {
        active: true,
        actor: member.sub,
        at: new Date(clock()).toISOString(),
      }
      state.commands = state.commands.map((c) =>
        c.status === 'queued'
          ? { ...c, status: 'suppressed' }
          : ['dispatched', 'acknowledged'].includes(c.status)
            ? { ...c, status: 'unknown' }
            : c,
      )
      audit(state, 'device_revoked', member.sub, clock())
    } else if (method === 'POST' && action === 'rotate') {
      if (
        body.confirmed !== true ||
        !profile ||
        profile.credentialVersion <= state.gatewayCredentialVersion
      )
        throw new ApiError(
          'A higher credential version must first be provisioned and verified in the server device profile.',
        )
      state.gatewayCredentialVersion = profile.credentialVersion
      state.gatewayId = profile.gatewayId
      state.revoked = false
      state.telemetry = null
      state.lastCycleAt = null
      if (state.policy) state.policy.enabled = false
      state.manualOverride = {
        active: true,
        actor: member.sub,
        at: new Date(clock()).toISOString(),
      }
      state.commands = state.commands.map((c) =>
        c.status === 'queued'
          ? { ...c, status: 'suppressed' }
          : ['dispatched', 'acknowledged'].includes(c.status)
            ? { ...c, status: 'unknown' }
            : c,
      )
      audit(state, 'credential_rotation_bound', member.sub, clock())
    } else if (method === 'POST' && action === 'reconcile') {
      const command = state.commands.find((c) => c.id === body.commandId)
      if (
        !command ||
        command.status !== 'unknown' ||
        body.confirmedPhysicalCheck !== true ||
        !profile ||
        deviceEvidenceState(state.telemetry, profile, clock()) !== 'current' ||
        Date.parse(state.telemetry.observedStateAt) <
          Date.parse(command.expiresAt) ||
        state.telemetry.observedState === 'unknown'
      )
        throw new ApiError(
          'Reconciliation needs an owner physical check and fresh observed state after command expiry.',
        )
      command.status = 'reconciled'
      command.observedAt = state.telemetry.observedStateAt
      audit(state, 'command_reconciled', member.sub, clock(), command.id)
    } else throw new ApiError('Device method is unavailable.', 405)
    return {
      device: await projection(await write(row, state, true, null, grant)),
    }
  }

  async function gateway(operation, body, identity) {
    // A selected gateway verifier must produce this identity; this seam is not an HTTP auth mechanism.
    if (
      !identity?.authenticated ||
      !id(identity.workspaceId) ||
      !id(identity.gatewayId) ||
      !Array.isArray(identity.deviceIds) ||
      !identity.deviceIds.includes(body?.deviceId)
    )
      throw new ApiError(
        'A scoped authenticated gateway identity is required.',
        401,
      )
    const row = await readDevice(identity.workspaceId, body.deviceId),
      state = expireCommands(row.data, clock()),
      profile = findProfile(state)
    if (
      !profile ||
      state.revoked ||
      state.gatewayId !== identity.gatewayId ||
      state.gatewayCredentialVersion !== identity.credentialVersion ||
      profile.credentialVersion !== identity.credentialVersion
    )
      throw new ApiError(
        'Gateway device credentials are revoked, expired or outside their scope.',
        403,
      )
    if (operation === 'telemetry') {
      const telemetry = validateDeviceTelemetry(
        body,
        profile,
        state.id,
        clock(),
      )
      if (state.telemetry && telemetry.sequence <= state.telemetry.sequence) {
        const prior = { ...state.telemetry, retrievedAt: null },
          next = { ...telemetry, retrievedAt: null }
        if (
          telemetry.sequence === state.telemetry.sequence &&
          hash(prior) === hash(next)
        )
          return { duplicate: true }
        throw new ApiError(
          'Telemetry sequence was duplicated with different data or arrived out of order.',
          409,
        )
      }
      if (
        state.telemetry &&
        Date.parse(telemetry.measuredAt) <
          Date.parse(state.telemetry.measuredAt)
      )
        throw new ApiError('Telemetry measurement time moved backwards.', 409)
      if (
        state.telemetry &&
        clock() - Date.parse(state.telemetry.retrievedAt) < 5000
      )
        throw new ApiError(
          'Telemetry admission is limited to one update per five seconds.',
          429,
        )
      if (
        (!state.telemetry ||
          telemetry.observedState !== state.telemetry.observedState) &&
        telemetry.observedState !== 'unknown'
      )
        state.lastCycleAt = new Date(clock()).toISOString()
      state.telemetry = telemetry
      const command = state.commands.find(
        (c) => c.id === telemetry.appliedCommandId,
      )
      if (
        command &&
        ['dispatched', 'acknowledged', 'unknown'].includes(command.status) &&
        telemetry.observedState === command.action &&
        Date.parse(telemetry.observedStateAt) >=
          Date.parse(command.dispatchedAt) &&
        deviceEvidenceState(telemetry, profile, clock()) === 'current'
      ) {
        command.status = 'observed'
        command.observedAt = telemetry.observedStateAt
        audit(
          state,
          'command_observed',
          identity.gatewayId,
          clock(),
          command.id,
        )
      }
      await write(row, state)
      return { accepted: true, sequence: telemetry.sequence }
    }
    if (operation === 'claim') {
      const command = state.commands.find((c) => c.status === 'queued')
      if (!command) return { command: null }
      let commandGrant
      try {
        commandGrant = await trustedMember({
          workspaceId: state.workspaceId,
          sub: command.actor,
          role: 'owner',
        })
        const withoutCommand = {
          ...state,
          commands: state.commands.filter((c) => c.id !== command.id),
        }
        await commandReady(
          withoutCommand,
          profile,
          command.action,
          outdoorProjection(
            await outdoorForDevice(state.id, state.workspaceId),
            clock(),
          ),
        )
        if (
          state.telemetry.sequence !== command.expectedTelemetrySequence ||
          state.telemetry.observedState !== command.expectedState ||
          command.operatingPolicyId !== profile.operatingPolicyId ||
          (command.rule &&
            (state.manualOverride.active ||
              !state.policy?.enabled ||
              state.policy.id !== command.rule))
        )
          safeError('Command evidence, policy or manual override changed.')
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
        command.status = 'suppressed'
        audit(
          state,
          'command_suppressed',
          identity.gatewayId,
          clock(),
          command.id,
        )
        await write(row, state)
        return { command: null, suppressed: true }
      }
      command.status = 'dispatched'
      command.dispatchedAt = new Date(clock()).toISOString()
      audit(
        state,
        'command_dispatched',
        identity.gatewayId,
        clock(),
        command.id,
      )
      await write(row, state, false, null, commandGrant)
      return {
        command: structuredClone(command),
        instruction:
          'Actuate at most once; reject expired commands; confirm observed state separately.',
      }
    }
    if (operation === 'acknowledge') {
      const command = state.commands.find((c) => c.id === body.commandId)
      if (
        !command ||
        !['accepted', 'rejected'].includes(body.outcome) ||
        !command.dispatchedAt
      )
        throw new ApiError(
          'Acknowledgment does not match a dispatched device command.',
        )
      if (command.acknowledgedAt) {
        if (command.acknowledgment !== body.outcome)
          throw new ApiError(
            'Acknowledgment conflicts with the recorded outcome.',
            409,
          )
        return { duplicate: true, status: command.status }
      }
      command.acknowledgedAt = new Date(clock()).toISOString()
      command.acknowledgment = body.outcome
      if (command.status !== 'observed')
        command.status =
          body.outcome === 'rejected'
            ? 'rejected'
            : Date.parse(command.expiresAt) <= clock()
              ? 'unknown'
              : 'acknowledged'
      audit(
        state,
        'command_acknowledged',
        identity.gatewayId,
        clock(),
        command.id,
      )
      await write(row, state)
      return { status: command.status }
    }
    throw new ApiError('Gateway operation is unavailable.', 404)
  }
  async function evaluateAutomation(workspaceId, deviceId) {
    const row = await readDevice(workspaceId, deviceId),
      state = expireCommands(row.data, clock()),
      profile = findProfile(state)
    if (
      !profile ||
      profile.kind !== 'purifier' ||
      profile.automationValidated !== true ||
      state.revoked ||
      !state.policy?.enabled ||
      state.manualOverride.active ||
      state.policy.operatingPolicyId !== profile.operatingPolicyId
    )
      return { queued: false, reason: 'disabled_or_override' }
    if (deviceEvidenceState(state.telemetry, profile, clock()) !== 'current')
      return { queued: false, reason: 'indoor_not_current' }
    const pm = state.telemetry.readings.find(
      (r) => r.pollutant === 'pm25' && r.statistic === 'instant',
    )
    if (!pm || pm.value === null)
      return { queued: false, reason: 'no_compatible_pm25' }
    const action =
      pm.value >= state.policy.startThreshold &&
      state.telemetry.observedState === 'off'
        ? 'on'
        : pm.value <= state.policy.stopThreshold &&
            state.telemetry.observedState === 'on'
          ? 'off'
          : null
    if (!action) return { queued: false, reason: 'hysteresis_hold' }
    if (
      state.lastCycleAt &&
      clock() - Date.parse(state.lastCycleAt) <
        state.policy.minimumCycleSeconds * 1000
    )
      return { queued: false, reason: 'minimum_cycle' }
    const member = { workspaceId, sub: state.policy.actor, role: 'owner' }
    await trustedMember(member)
    try {
      const result = await enqueueCommand(
        row,
        {
          commandId: `auto_${hash({ deviceId, policy: state.policy.id, sequence: state.telemetry.sequence, action })}`,
          action,
          expiresAt: new Date(clock() + 60000).toISOString(),
          version: row.version,
          expectedTelemetrySequence: state.telemetry.sequence,
          operatingPolicyId: profile.operatingPolicyId,
          confirmedPolicy: true,
        },
        member,
        true,
      )
      return { queued: true, command: result.command }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      return { queued: false, reason: 'blocked_by_operating_policy' }
    }
  }
  return {
    route,
    gateway,
    evaluateAutomation,
    capabilities: () => r5Capabilities(profiles, clock()),
  }
}
