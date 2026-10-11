import { distanceKm, finite, timestamp, unit } from './core.mjs'

// Open-Meteo PM values are instantaneous model samples. This is an explicit
// piecewise-linear approximation of their mean over an observation period.
export function periodForecast(forecast, period) {
  const start = Date.parse(period?.start),
    end = Date.parse(period?.end)
  if (!(end > start) || end - start > 86400000) return null
  const points = forecast.points
    .map((point) => ({ at: Date.parse(point.time), value: point.pm25 }))
    .filter((point) => Number.isFinite(point.at))
    .sort((a, b) => a.at - b.at)
  let covered = 0,
    integral = 0
  for (let index = 0; index + 1 < points.length; index++) {
    const a = points[index],
      b = points[index + 1],
      left = Math.max(a.at, start),
      right = Math.min(b.at, end)
    if (right <= left) continue
    if (
      finite(a.value) === null ||
      finite(b.value) === null ||
      a.value < 0 ||
      b.value < 0 ||
      b.at - a.at > 3600000
    )
      return null
    const at = (time) =>
      a.value + ((b.value - a.value) * (time - a.at)) / (b.at - a.at)
    integral += ((at(left) + at(right)) / 2) * (right - left)
    covered += right - left
  }
  return covered === end - start ? integral / covered : null
}
export function metrics(pairs, threshold) {
  if (!pairs.length)
    return {
      count: 0,
      bias: null,
      mae: null,
      rmse: null,
      missedCrossings: 0,
      falseCrossings: 0,
    }
  const errors = pairs.map((pair) => pair.predicted - pair.observed)
  return {
    count: pairs.length,
    bias: errors.reduce((a, b) => a + b, 0) / errors.length,
    mae: errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length,
    rmse: Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / errors.length),
    missedCrossings: pairs.filter(
      (pair) => pair.observed > threshold && pair.predicted <= threshold,
    ).length,
    falseCrossings: pairs.filter(
      (pair) => pair.observed <= threshold && pair.predicted > threshold,
    ).length,
  }
}
export function evaluate(
  forecasts,
  observations,
  { threshold, cutoff, radiusKm = 50 },
) {
  if (!(threshold > 0 && threshold <= 1000) || !timestamp(cutoff))
    throw new Error(
      'Provide a review threshold and a chronological holdout cutoff with timezone.',
    )
  const deduped = new Map(),
    pairs = [],
    skipped = {
      incompatible: 0,
      noProspectiveForecast: 0,
      incompleteForecast: 0,
    }
  for (const row of observations) {
    const id = `${row.originId || row.sensorId || row.canonicalStationId}|${row.period?.start}|${row.period?.end}`
    if (
      !deduped.has(id) ||
      Date.parse(row.fetchedAt) > Date.parse(deduped.get(id).fetchedAt)
    )
      deduped.set(id, row)
  }
  for (const row of deduped.values()) {
    if (
      row.pollutant !== 'PM2.5' ||
      !unit(row.unit) ||
      row.statistic !== 'mean' ||
      !timestamp(row.period?.start) ||
      !timestamp(row.period?.end) ||
      finite(row.value) === null ||
      row.value < 0 ||
      row.qualityFlags?.length ||
      finite(row.latitude) === null ||
      finite(row.longitude) === null
    ) {
      skipped.incompatible++
      continue
    }
    const candidates = forecasts
      .filter(
        (forecast) =>
          unit(forecast.unit) &&
          timestamp(forecast.fetchedAt) &&
          Date.parse(forecast.fetchedAt) < Date.parse(row.period.start) &&
          distanceKm(
            row.latitude,
            row.longitude,
            forecast.grid.latitude,
            forecast.grid.longitude,
          ) <= radiusKm,
      )
      .sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))
    if (!candidates.length) {
      skipped.noProspectiveForecast++
      continue
    }
    const forecast = candidates[0],
      predicted = periodForecast(forecast, row.period)
    if (predicted === null) {
      skipped.incompleteForecast++
      continue
    }
    pairs.push({
      station: row.canonicalStationId || row.providerStationId,
      origin: row.originId,
      end: row.period.end,
      predicted,
      observed: row.value,
      leadHoursSinceRetrieval:
        (Date.parse(row.period.start) - Date.parse(forecast.fetchedAt)) /
        3600000,
    })
  }
  const training = pairs.filter(
      (pair) => Date.parse(pair.end) < Date.parse(cutoff),
    ),
    holdout = pairs.filter(
      (pair) => Date.parse(pair.end) >= Date.parse(cutoff),
    ),
    trainingMetrics = metrics(training, threshold),
    offset = Math.max(-50, Math.min(50, -(trainingMetrics.bias || 0)))
  return {
    schemaVersion: 1,
    method:
      'Prospective archives; piecewise-linear period mean approximation; lead time since retrieval, not model issue time.',
    threshold,
    cutoff,
    radiusKm,
    skipped,
    training: trainingMetrics,
    holdout: metrics(holdout, threshold),
    experimentalBiasCandidate: {
      offset,
      holdout: metrics(
        holdout.map((pair) => ({
          ...pair,
          predicted: Math.max(0, pair.predicted + offset),
        })),
        threshold,
      ),
      appliedToApp: false,
      releaseStatus: 'research_only_requires_independent_validation',
    },
    leads: [0, 6, 24, 48].map((start, index, limits) => ({
      startHours: start,
      endHours: limits[index + 1] || null,
      ...metrics(
        holdout.filter(
          (pair) =>
            pair.leadHoursSinceRetrieval >= start &&
            pair.leadHoursSinceRetrieval < (limits[index + 1] || Infinity),
        ),
        threshold,
      ),
    })),
    pairs,
  }
}
