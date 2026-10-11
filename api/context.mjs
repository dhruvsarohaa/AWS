import { ApiError, areaFor, sourceAge, coordinates } from './core.mjs'
import { capabilities } from './capabilities.mjs'
import { fetchWeather } from './providers/weather.mjs'
import { fetchFires } from './providers/fires.mjs'
import { planningDate } from './public-evidence.mjs'
export function createContext({
  store,
  engine,
  request,
  keys,
  enqueue,
  archive,
}) {
  async function schedule(area, family) {
    if (
      !capabilities()[family] ||
      process.env.INGESTION_ENABLED === 'false' ||
      (await store.get('CONTROL'))?.data.paused
    )
      return
    const previous = await store.get(`CONTEXT#${area.id}`, family)
    if (
      previous?.refreshAt > Date.now() ||
      !(await store.claim(`CONTEXT_QUEUE#${family}#${area.id}`, 60))
    )
      return
    await enqueue({ type: 'context.refresh', family, area })
  }
  async function read(place, date, family) {
    if (!['weather', 'fires'].includes(family))
      throw new ApiError('Context family is invalid.')
    if (!capabilities()[family])
      return { schemaVersion: 1, family, status: 'disabled', evidence: null }
    planningDate(date)
    const area = areaFor(place)
    // Admission and demand use the existing capped air-area path, not a second unlimited registry.
    const dashboard = await engine.dashboard({ ...place, detected: true }, date)
    const admitted = await store.get('DEMAND', area.id)
    if (admitted?.expireAt > Date.now() / 1000)
      try {
        await schedule(area, family)
      } catch {
        console.warn(
          JSON.stringify({ event: 'context_queue_unavailable', family }),
        )
      }
    const row = await store.get(`CONTEXT#${area.id}`, family),
      evidence = row?.data.value || null
    return {
      schemaVersion: 1,
      family,
      status: row?.data.status || 'pending',
      lastAttemptAt: row?.data.lastAttemptAt || null,
      lastSuccessAt: row?.data.lastSuccessAt || null,
      message: row?.data.message || null,
      age: sourceAge(evidence?.fetchedAt, Date.now(), 3 * 3600000),
      date,
      areaId: area.id,
      evidence:
        family === 'weather' && evidence
          ? {
              ...evidence,
              points: evidence.points.filter(
                (p) =>
                  new Date(p.time).toLocaleDateString('sv-SE', {
                    timeZone: 'Asia/Kolkata',
                  }) === date,
              ),
            }
          : evidence,
      airPending: dashboard.pending,
    }
  }
  async function refresh(job) {
    const { area, family } = job
    if (
      job.type !== 'context.refresh' ||
      !['weather', 'fires'].includes(family) ||
      !area ||
      !coordinates(area.latitude, area.longitude) ||
      areaFor({
        latitude: area.latitude,
        longitude: area.longitude,
        detected: true,
      }).id !== area.id
    )
      throw new ApiError('Invalid context job.')
    const demand = await store.get('DEMAND', area.id)
    if (
      !capabilities()[family] ||
      process.env.INGESTION_ENABLED === 'false' ||
      (await store.get('CONTROL'))?.data.paused ||
      !demand ||
      demand.expireAt <= Date.now() / 1000 ||
      !(await store.claim(`CONTEXT_WORKER#${family}#${area.id}`, 90))
    )
      return
    try {
      const previous = await store.get(`CONTEXT#${area.id}`, family)
      if (previous?.refreshAt > Date.now()) return
      const lastAttemptAt = new Date().toISOString()
      try {
        const result = await (family === 'weather' ? fetchWeather : fetchFires)(
          area,
          request,
          await keys(),
        )
        await store.put(
          `CONTEXT#${area.id}`,
          family,
          {
            value: result.value,
            status:
              family === 'fires' && !result.value.detections.length
                ? 'no_detections'
                : 'available',
            lastAttemptAt,
            lastSuccessAt: result.value.fetchedAt,
          },
          {
            refreshAt: Date.now() + 3600000,
            expireAt: Math.floor(Date.now() / 1000) + 7 * 86400,
          },
        )
        try {
          await archive(family, { normalized: result.value, raw: result.raw })
        } catch {
          console.warn(
            JSON.stringify({ event: 'context_archive_failed', family }),
          )
        }
      } catch (error) {
        await store.put(
          `CONTEXT#${area.id}`,
          family,
          {
            value: previous?.data.value || null,
            status:
              error.code === 'provider_not_configured'
                ? 'not_configured'
                : 'unavailable',
            lastAttemptAt,
            lastSuccessAt: previous?.data.lastSuccessAt || null,
            message:
              error instanceof ApiError
                ? error.message
                : 'Context provider failed. Retained evidence keeps its original timestamp.',
          },
          {
            refreshAt: Date.now() + 5 * 60000,
            expireAt: Math.floor(Date.now() / 1000) + 7 * 86400,
          },
        )
      }
    } finally {
      await store.delete(`CONTEXT_WORKER#${family}#${area.id}`, 'lock')
    }
  }
  async function dispatch() {
    for (const row of await store.list('DEMAND', 100))
      if (row.expireAt > Date.now() / 1000)
        for (const family of ['weather', 'fires'])
          try {
            await schedule(row.data, family)
          } catch {
            console.warn(
              JSON.stringify({ event: 'context_queue_unavailable', family }),
            )
          }
  }
  return { read, refresh, dispatch }
}
