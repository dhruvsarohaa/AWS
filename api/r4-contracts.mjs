import { ApiError, coordinates, timestamp } from './core.mjs'

const text = (v, max = 100) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max
const number = (v, min, max) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const id = (v) => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(v)
const at = (v) => timestamp(v)
const fail = (message) => {
  throw new ApiError(message)
}
function provenance(raw, now) {
  if (
    !raw ||
    raw.schemaVersion !== 1 ||
    !id(raw.provider) ||
    !text(raw.attribution, 300) ||
    !text(raw.licenseReference, 160) ||
    raw.kind !== 'model' ||
    raw.production !== true ||
    !at(raw.retrievedAt) ||
    Date.parse(raw.retrievedAt) > now + 300000 ||
    !number(raw.resolutionMeters, 1, 50000)
  )
    fail('Integration provenance is incomplete or unverified.')
  return {
    schemaVersion: 1,
    provider: raw.provider,
    attribution: raw.attribution,
    licenseReference: raw.licenseReference,
    kind: 'model',
    production: true,
    retrievedAt: at(raw.retrievedAt),
    resolutionMeters: raw.resolutionMeters,
  }
}

/** Normalize a reviewed provider response; never call this on client-supplied routes to establish legality. */
export function compareReviewedRoutes(raw, review, now = Date.now()) {
  if (
    !review ||
    review.license !== true ||
    review.delhiPilot !== true ||
    !number(review.maxResolutionMeters, 1, 1000) ||
    !id(review.evaluationId)
  )
    fail('Routing/pollution pilot is not reviewed.')
  if (
    !raw ||
    !Array.isArray(raw.routes) ||
    raw.routes.length < 1 ||
    raw.routes.length > 3 ||
    !at(raw.departureAt) ||
    Date.parse(raw.departureAt) < now - 60000 ||
    Date.parse(raw.departureAt) > now + 3 * 86400000 ||
    !['walk', 'bicycle', 'car'].includes(raw.mode) ||
    !id(raw.routingProvider) ||
    !text(raw.routeAttribution, 300)
  )
    fail('Route request or legal route contract is invalid.')
  const routeIds = new Set()
  const air = raw.air ? provenance(raw.air, now) : null
  if (
    air &&
    (raw.air.pollutant !== 'pm25' ||
      raw.air.unit !== 'µg/m³' ||
      raw.air.statistic !== 'segment_mean' ||
      !id(raw.air.modelId) ||
      !number(raw.air.maxAgeMinutes, 1, 180))
  )
    fail('Route air fields are incompatible.')
  const normalized = raw.routes.map((route) => {
    if (
      !route ||
      !id(route.id) ||
      routeIds.has(route.id) ||
      route.permitted !== true ||
      Date.parse(route.departureAt) !== Date.parse(raw.departureAt) ||
      route.mode !== raw.mode ||
      !number(route.durationSeconds, 1, 14400) ||
      !number(route.distanceMeters, 1, 100000) ||
      !Array.isArray(route.geometry) ||
      route.geometry.length < 2 ||
      route.geometry.length > 2000 ||
      route.geometry.some(
        (point) =>
          !Array.isArray(point) ||
          point.length !== 2 ||
          !coordinates(point[1], point[0]),
      ) ||
      !Array.isArray(route.segments) ||
      route.segments.length < 1 ||
      route.segments.length > 500
    )
      fail(
        'Route geometry, legality, travel assumptions or segment bounds are invalid.',
      )
    routeIds.add(route.id)
    let seconds = 0,
      integral = 0,
      lower = 0,
      upper = 0,
      missingSeconds = 0
    const cells = new Set()
    const segments = route.segments.map((segment) => {
      if (
        !segment ||
        !number(segment.seconds, 0.1, 14400) ||
        !id(segment.cellId) ||
        !(segment.value === null || number(segment.value, 0, 10000)) ||
        !(
          segment.uncertainty === null || number(segment.uncertainty, 0, 10000)
        ) ||
        !at(segment.validFrom) ||
        !at(segment.validTo) ||
        Date.parse(segment.validFrom) >= Date.parse(segment.validTo)
      )
        fail('Route segment evidence is invalid.')
      const begins = Date.parse(raw.departureAt) + seconds * 1000,
        ends = begins + segment.seconds * 1000
      if (
        Date.parse(segment.validFrom) > begins ||
        Date.parse(segment.validTo) < ends
      )
        fail('Route evidence does not cover its matched traversal time.')
      seconds += segment.seconds
      cells.add(segment.cellId)
      if (segment.value === null || segment.uncertainty === null || !air)
        missingSeconds += segment.seconds
      else {
        integral += (segment.value * segment.seconds) / 3600
        lower +=
          (Math.max(0, segment.value - segment.uncertainty) * segment.seconds) /
          3600
        upper +=
          ((segment.value + segment.uncertainty) * segment.seconds) / 3600
      }
      return {
        seconds: segment.seconds,
        cellId: segment.cellId,
        value: segment.value,
        uncertainty: segment.uncertainty,
        validFrom: at(segment.validFrom),
        validTo: at(segment.validTo),
      }
    })
    if (Math.abs(seconds - route.durationSeconds) > 0.01)
      fail('Route segment times do not match the travel duration.')
    return {
      id: route.id,
      durationSeconds: route.durationSeconds,
      distanceMeters: route.distanceMeters,
      geometry: route.geometry.map((point) => [...point]),
      segments,
      missingSeconds,
      estimate: missingSeconds ? null : integral,
      lower: missingSeconds ? null : lower,
      upper: missingSeconds ? null : upper,
      cells: [...cells].sort(),
    }
  })
  let reason = 'supported',
    ranking = null
  const signature = (route) => route.cells.join('|')
  if (normalized.length < 2) reason = 'one_route'
  else if (!air) reason = 'no_compatible_air'
  else if (air.resolutionMeters > review.maxResolutionMeters)
    reason = 'unresolved_spatial_resolution'
  else if (now - Date.parse(air.retrievedAt) > raw.air.maxAgeMinutes * 60000)
    reason = 'stale_air'
  else if (normalized.some((route) => route.missingSeconds > 0))
    reason = 'missing_segments'
  else if (new Set(normalized.map(signature)).size !== normalized.length)
    reason = 'shared_unresolved_cells'
  else {
    const sorted = [...normalized].sort((a, b) => a.estimate - b.estimate)
    if (sorted.some((route, i) => i > 0 && sorted[i - 1].upper >= route.lower))
      reason = 'overlapping_uncertainty'
    else ranking = sorted.map((route) => route.id)
  }
  return {
    schemaVersion: 1,
    departureAt: at(raw.departureAt),
    mode: raw.mode,
    routingProvider: raw.routingProvider,
    routeAttribution: raw.routeAttribution,
    evidence: air,
    evaluationId: review.evaluationId,
    estimateUnit: 'µg/m³ × hours',
    criterion:
      'Complete segment-time integral; ranking requires non-overlapping uncertainty bounds and distinct resolving cells.',
    status: ranking ? 'ranked_model_comparison' : 'travel_only',
    reason,
    ranking,
    routes: normalized,
    limitation:
      'Modeled concentration-time is not inhaled dose, a health outcome or proof of safe air.',
  }
}

export function validateIndianPollen(raw, review, place, now = Date.now()) {
  if (
    !review ||
    review.license !== true ||
    review.indianCoverage !== true ||
    review.taxa !== true ||
    review.units !== true
  )
    fail('Indian pollen contract is not reviewed.')
  if (
    !raw ||
    raw.schemaVersion !== 1 ||
    raw.country !== 'IN' ||
    !id(raw.provider) ||
    !text(raw.attribution, 300) ||
    !text(raw.licenseReference, 160) ||
    raw.production !== true ||
    !at(raw.retrievedAt) ||
    Date.parse(raw.retrievedAt) > now + 300000 ||
    !number(raw.maxAgeMinutes, 1, 1440) ||
    !Array.isArray(raw.bounds) ||
    raw.bounds.length !== 4 ||
    !coordinates(raw.bounds[1], raw.bounds[0]) ||
    !coordinates(raw.bounds[3], raw.bounds[2]) ||
    raw.bounds[0] >= raw.bounds[2] ||
    raw.bounds[1] >= raw.bounds[3] ||
    !Array.isArray(raw.points) ||
    raw.points.length > 2000
  )
    fail('Indian pollen response metadata is invalid.')
  if (
    !place ||
    !coordinates(place.latitude, place.longitude) ||
    place.longitude < raw.bounds[0] ||
    place.longitude > raw.bounds[2] ||
    place.latitude < raw.bounds[1] ||
    place.latitude > raw.bounds[3]
  )
    return { schemaVersion: 1, status: 'no_coverage', points: [] }
  const last = new Map()
  const points = raw.points.map((point) => {
    if (
      !point ||
      !id(point.taxon) ||
      point.unit !== 'grains/m³' ||
      point.statistic !== 'interval_mean' ||
      !at(point.start) ||
      !at(point.end) ||
      Date.parse(point.start) >= Date.parse(point.end) ||
      Date.parse(point.end) - Date.parse(point.start) > 86400000 ||
      Date.parse(point.start) < now - 86400000 ||
      Date.parse(point.end) > now + 3 * 86400000 ||
      !(point.value === null || number(point.value, 0, 100000))
    )
      fail('Pollen taxa, units, interval or value is invalid.')
    const start = at(point.start),
      end = at(point.end)
    if (last.has(point.taxon) && start < last.get(point.taxon))
      fail('Pollen intervals overlap or arrive out of order.')
    last.set(point.taxon, end)
    return {
      taxon: point.taxon,
      unit: 'grains/m³',
      statistic: 'interval_mean',
      start,
      end,
      value: point.value,
    }
  })
  return {
    schemaVersion: 1,
    status:
      now - Date.parse(raw.retrievedAt) > raw.maxAgeMinutes * 60000
        ? 'stale'
        : points.length
          ? 'available'
          : 'no_data',
    provider: raw.provider,
    attribution: raw.attribution,
    retrievedAt: at(raw.retrievedAt),
    country: 'IN',
    bounds: [...raw.bounds],
    points,
    limitation:
      'Taxon-specific pollen evidence is separate from PM planning; no diagnosis or route recommendation is derived.',
  }
}

export function validateDenseAir(raw, review, now = Date.now()) {
  if (
    !review ||
    review.license !== true ||
    review.coverage !== true ||
    review.referenceEvaluation !== true ||
    review.uncertainty !== true ||
    !id(review.evaluationId) ||
    !id(review.archiveId) ||
    !number(review.maxResolutionMeters, 1, 1000) ||
    !Number.isInteger(review.independentReferences) ||
    review.independentReferences < 3
  )
    fail('Dense air reference evaluation is not reviewed.')
  const meta = provenance(raw, now)
  if (
    meta.resolutionMeters > review.maxResolutionMeters ||
    raw.pollutant !== 'pm25' ||
    raw.unit !== 'µg/m³' ||
    raw.statistic !== 'interval_mean' ||
    !at(raw.validFrom) ||
    !at(raw.validTo) ||
    Date.parse(raw.validFrom) >= Date.parse(raw.validTo) ||
    Date.parse(raw.validTo) - Date.parse(raw.validFrom) > 3 * 3600000 ||
    Date.parse(raw.validFrom) > now + 3 * 86400000 ||
    !Array.isArray(raw.cells) ||
    raw.cells.length < 3 ||
    raw.cells.length > 500
  )
    fail('Dense air scale, unit, period or density is unsupported.')
  const seen = new Set()
  const cells = raw.cells.map((cell) => {
    if (
      !cell ||
      !id(cell.id) ||
      seen.has(cell.id) ||
      !coordinates(cell.latitude, cell.longitude) ||
      !(cell.value === null || number(cell.value, 0, 10000)) ||
      !number(cell.uncertainty, 0, 10000)
    )
      fail('Dense air cells are invalid.')
    seen.add(cell.id)
    return {
      id: cell.id,
      latitude: cell.latitude,
      longitude: cell.longitude,
      value: cell.value,
      uncertainty: cell.uncertainty,
    }
  })
  return {
    ...meta,
    status:
      now - Date.parse(meta.retrievedAt) > 3 * 3600000 ||
      Date.parse(raw.validTo) < now
        ? 'stale'
        : 'available',
    pollutant: 'pm25',
    unit: 'µg/m³',
    statistic: 'interval_mean',
    validFrom: at(raw.validFrom),
    validTo: at(raw.validTo),
    evaluationId: review.evaluationId,
    archiveId: review.archiveId,
    independentReferences: review.independentReferences,
    cells,
    rendering: 'validated_cells_only',
    sourceAttribution: false,
    limitation:
      'No interpolation outside validated cells, and no pollutant-source attribution from wind or fire points.',
  }
}

/** Adapter boundary only: platform OAuth/token refresh/revocation cannot be invented before platform selection. */
export function validateWearableBatch(raw, connection, now = Date.now()) {
  if (
    !connection ||
    connection.consent !== true ||
    connection.revoked === true ||
    !id(connection.platform) ||
    !id(connection.accountId) ||
    !at(connection.expiresAt) ||
    Date.parse(connection.expiresAt) <= now ||
    !Array.isArray(connection.scopes) ||
    connection.scopes.length !== 1 ||
    connection.scopes[0] !== 'activity:read'
  )
    fail('Wearable consent or connection is unavailable.')
  if (
    !raw ||
    raw.platform !== connection.platform ||
    !Array.isArray(raw.activities) ||
    raw.activities.length > 20
  )
    fail('Wearable import batch is invalid.')
  const seen = new Set()
  const activities = raw.activities
    .map((activity) => {
      if (
        !activity ||
        !id(activity.id) ||
        !at(activity.startedAt) ||
        !at(activity.endedAt) ||
        Date.parse(activity.startedAt) >= Date.parse(activity.endedAt) ||
        Date.parse(activity.startedAt) < now - 366 * 86400000 ||
        Date.parse(activity.endedAt) > now + 300000 ||
        Date.parse(activity.endedAt) - Date.parse(activity.startedAt) >
          86400000 ||
        !['walk', 'run', 'cycle', 'other'].includes(activity.kind)
      )
        fail('Wearable activity bounds or provenance are invalid.')
      const dedupeId = `${connection.platform}:${connection.accountId}:${activity.id}`
      if (seen.has(dedupeId)) return null
      seen.add(dedupeId)
      return {
        dedupeId,
        source: 'wearable_import',
        platform: connection.platform,
        externalActivityId: activity.id,
        startedAt: at(activity.startedAt),
        endedAt: at(activity.endedAt),
        kind: activity.kind,
      }
    })
    .filter(Boolean)
  return {
    schemaVersion: 1,
    activities,
    duplicateCount: raw.activities.length - activities.length,
    limitation:
      'No route, precise coordinates, heart rate or health profile is imported by this neutral activity contract.',
  }
}
