export type R5Reading = {
  pollutant: 'pm25' | 'pm10'
  value: number | null
  unit: 'µg/m³'
  statistic: 'instant' | 'mean'
  period: { start: string; end: string } | null
}
export type R5Command = {
  schemaVersion: 1
  id: string
  action: 'on' | 'off'
  status:
    | 'queued'
    | 'dispatched'
    | 'acknowledged'
    | 'observed'
    | 'expired'
    | 'unknown'
    | 'suppressed'
    | 'rejected'
    | 'reconciled'
  createdAt: string
  expiresAt: string
  acknowledgedAt: string | null
  observedAt: string | null
  rule: string | null
}
export type R5Telemetry = {
  schemaVersion: 1
  deviceId: string
  source: string
  origin: 'live'
  sequence: number
  measuredAt: string
  retrievedAt: string
  observedState: 'on' | 'off' | 'unknown'
  observedStateAt: string
  readings: R5Reading[]
  qualityFlags: string[]
  interlocks: {
    id: string
    satisfied: boolean
    checkedAt: string
    validUntil: string
  }[]
}
export type R5Outdoor = {
  source: string
  family: 'observation' | 'model_forecast'
  origin: 'live' | 'sample' | 'replay'
  pollutant: 'pm25'
  value: number | null
  unit: 'µg/m³'
  statistic: 'instant' | 'mean' | 'model_sample'
  validAt: string
  retrievedAt: string
  maxAgeSeconds: number
  state: string
  evidenceId: string
  attribution: string
  identity: string
}
export type R5Device = {
  schemaVersion: 1
  id: string
  name: string
  kind: 'sensor' | 'purifier' | 'ventilation' | 'dust_suppression'
  source: string
  workspaceId: string
  version: number
  maxAgeSeconds: number
  minimumCycleSeconds: number | null
  placement: { room: string; note: string; installedAt: string }
  calibration: { at: string; method: string; reference: string }
  revoked: boolean
  integrationAvailable: boolean
  controlsAvailable: boolean
  automationAvailable: boolean
  evidenceState: 'current' | 'stale' | 'unverified' | 'unavailable'
  telemetry: R5Telemetry | null
  outdoor: R5Outdoor | null
  outdoorRefreshFailed: boolean
  commands: R5Command[]
  policy: {
    id: string
    enabled: boolean
    startThreshold: number
    stopThreshold: number
    minimumCycleSeconds: number
  } | null
  manualOverride: { active: boolean; actor: string; at: string }
  operatingPolicyId: string | null
  disconnectionPolicy: string | null
  interlocksReady: boolean
  credentialRotationAvailable: boolean
  lastCycleAt: string | null
}
export type R5DevicesResponse = {
  schemaVersion: 1
  membership: {
    workspaceId: string
    role: 'owner' | 'approver' | 'reviewer'
    sub: string
  }
  registryVersion: number
  devices: R5Device[]
  profiles: {
    id: string
    name: string
    kind: R5Device['kind']
    source: string
    deviceIds: string[]
  }[]
}
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
const safeId = (v: unknown) =>
  typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v)
const text = (v: unknown, max: number) =>
  typeof v === 'string' && Boolean(v.trim()) && v.length <= max
const time = (v: unknown) =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT/.test(v) &&
  Number.isFinite(Date.parse(v))
const finite = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const kind = (v: unknown) =>
  ['sensor', 'purifier', 'ventilation', 'dust_suppression'].includes(String(v))
const reading = (value: unknown) => {
  const r = object(value),
    period = object(r?.period)
  return (
    r &&
    ['pm25', 'pm10'].includes(String(r.pollutant)) &&
    r.unit === 'µg/m³' &&
    (r.value === null || finite(r.value, 0, 5000)) &&
    ['instant', 'mean'].includes(String(r.statistic)) &&
    (r.statistic === 'instant'
      ? r.period === null
      : period &&
        time(period.start) &&
        time(period.end) &&
        Date.parse(String(period.end)) > Date.parse(String(period.start)))
  )
}
export function readR5Devices(value: unknown): R5DevicesResponse {
  const v = object(value),
    member = object(v?.membership)
  if (
    !v ||
    v.schemaVersion !== 1 ||
    !member ||
    !safeId(member.workspaceId) ||
    !safeId(member.sub) ||
    !['owner', 'approver', 'reviewer'].includes(String(member.role)) ||
    !Number.isSafeInteger(v.registryVersion) ||
    Number(v.registryVersion) < 0 ||
    !Array.isArray(v.devices) ||
    v.devices.length > 10 ||
    !Array.isArray(v.profiles) ||
    v.profiles.length > 10
  )
    throw new Error('Device response could not be verified.')
  for (const value of v.devices) {
    const d = object(value),
      placement = object(d?.placement),
      calibration = object(d?.calibration),
      override = object(d?.manualOverride)
    if (
      !d ||
      d.schemaVersion !== 1 ||
      !safeId(d.id) ||
      !text(d.name, 80) ||
      !kind(d.kind) ||
      !text(d.source, 120) ||
      d.workspaceId !== member.workspaceId ||
      !Number.isSafeInteger(d.version) ||
      Number(d.version) < 1 ||
      !finite(d.maxAgeSeconds, 30, 3600) ||
      !(
        d.minimumCycleSeconds === null ||
        finite(d.minimumCycleSeconds, 60, 3600)
      ) ||
      !placement ||
      !text(placement.room, 80) ||
      !text(placement.note, 300) ||
      !time(placement.installedAt) ||
      !calibration ||
      !time(calibration.at) ||
      !text(calibration.method, 120) ||
      !text(calibration.reference, 120) ||
      !override ||
      typeof override.active !== 'boolean' ||
      !safeId(override.actor) ||
      !time(override.at) ||
      !['current', 'stale', 'unverified', 'unavailable'].includes(
        String(d.evidenceState),
      ) ||
      ![
        'revoked',
        'integrationAvailable',
        'controlsAvailable',
        'automationAvailable',
        'interlocksReady',
        'credentialRotationAvailable',
        'outdoorRefreshFailed',
      ].every((key) => typeof d[key] === 'boolean') ||
      !(d.operatingPolicyId === null || text(d.operatingPolicyId, 80)) ||
      !(d.disconnectionPolicy === null || text(d.disconnectionPolicy, 300)) ||
      !(d.lastCycleAt === null || time(d.lastCycleAt)) ||
      !Array.isArray(d.commands) ||
      d.commands.length > 50
    )
      throw new Error('Device metadata could not be verified.')
    if (d.telemetry !== null) {
      const t = object(d.telemetry)
      if (
        !t ||
        t.schemaVersion !== 1 ||
        t.deviceId !== d.id ||
        t.source !== d.source ||
        t.origin !== 'live' ||
        !Number.isSafeInteger(t.sequence) ||
        Number(t.sequence) < 1 ||
        !time(t.measuredAt) ||
        !time(t.retrievedAt) ||
        !time(t.observedStateAt) ||
        !['on', 'off', 'unknown'].includes(String(t.observedState)) ||
        !Array.isArray(t.readings) ||
        !t.readings.length ||
        t.readings.length > 2 ||
        !t.readings.every(reading) ||
        !Array.isArray(t.qualityFlags) ||
        t.qualityFlags.length > 8 ||
        !t.qualityFlags.every((flag) =>
          [
            'warmup',
            'calibration_due',
            'sensor_error',
            'placement_changed',
            'unverified',
          ].includes(String(flag)),
        ) ||
        !Array.isArray(t.interlocks) ||
        t.interlocks.length > 10 ||
        !t.interlocks.every((v) => {
          const i = object(v)
          return (
            i &&
            safeId(i.id) &&
            typeof i.satisfied === 'boolean' &&
            time(i.checkedAt) &&
            time(i.validUntil)
          )
        })
      )
        throw new Error('Indoor telemetry could not be verified.')
    }
    if (d.outdoor !== null) {
      const o = object(d.outdoor)
      if (
        !o ||
        !text(o.source, 120) ||
        !['observation', 'model_forecast'].includes(String(o.family)) ||
        !['live', 'sample', 'replay'].includes(String(o.origin)) ||
        o.pollutant !== 'pm25' ||
        o.unit !== 'µg/m³' ||
        !(o.value === null || finite(o.value, 0, 5000)) ||
        !['instant', 'mean', 'model_sample'].includes(String(o.statistic)) ||
        !time(o.validAt) ||
        !time(o.retrievedAt) ||
        !finite(o.maxAgeSeconds, 30, 10800) ||
        !['current', 'stale', 'unverified'].includes(String(o.state)) ||
        !text(o.evidenceId, 80) ||
        !text(o.identity, 120) ||
        !text(o.attribution, 300)
      )
        throw new Error('Outdoor device context could not be verified.')
    }
    for (const value of d.commands) {
      const c = object(value)
      if (
        !c ||
        c.schemaVersion !== 1 ||
        !safeId(c.id) ||
        !['on', 'off'].includes(String(c.action)) ||
        ![
          'queued',
          'dispatched',
          'acknowledged',
          'observed',
          'expired',
          'unknown',
          'suppressed',
          'rejected',
          'reconciled',
        ].includes(String(c.status)) ||
        !time(c.createdAt) ||
        !time(c.expiresAt) ||
        !(c.acknowledgedAt === null || time(c.acknowledgedAt)) ||
        !(c.observedAt === null || time(c.observedAt)) ||
        !(c.rule === null || safeId(c.rule))
      )
        throw new Error('Device command state could not be verified.')
    }
    if (d.policy !== null) {
      const p = object(d.policy)
      if (
        !p ||
        !safeId(p.id) ||
        typeof p.enabled !== 'boolean' ||
        !finite(p.startThreshold, 1, 1000) ||
        !finite(p.stopThreshold, 0, 999) ||
        Number(p.stopThreshold) >= Number(p.startThreshold) ||
        !finite(p.minimumCycleSeconds, 60, 3600)
      )
        throw new Error('Device automation settings could not be verified.')
    }
  }
  if (new Set(v.devices.map((d) => object(d)?.id)).size !== v.devices.length)
    throw new Error('Duplicate device identity.')
  for (const value of v.profiles) {
    const p = object(value)
    if (
      !p ||
      !safeId(p.id) ||
      !text(p.name, 80) ||
      !kind(p.kind) ||
      !text(p.source, 120) ||
      !Array.isArray(p.deviceIds) ||
      !p.deviceIds.length ||
      p.deviceIds.length > 10 ||
      !p.deviceIds.every(safeId)
    )
      throw new Error('Validated device profiles could not be verified.')
  }
  return v as unknown as R5DevicesResponse
}
export function r5CurrentIndoor(device: R5Device, now: number) {
  const t = device.telemetry
  return (
    device.integrationAvailable &&
    device.evidenceState === 'current' &&
    t !== null &&
    !t.qualityFlags.length &&
    Date.parse(t.measuredAt) <= now &&
    now - Date.parse(t.measuredAt) <= device.maxAgeSeconds * 1000 &&
    t.readings.every(
      (r) =>
        r.statistic !== 'mean' ||
        (r.period !== null &&
          Date.parse(r.period.end) <= now &&
          now - Date.parse(r.period.end) <= device.maxAgeSeconds * 1000),
    ) &&
    Date.parse(t.observedStateAt) <= now &&
    now - Date.parse(t.observedStateAt) <= device.maxAgeSeconds * 1000
  )
}
