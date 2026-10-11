import {
  ApiError,
  areaFor,
  comparable,
  distanceKm,
  hash,
  sourceAge,
} from './core.mjs'
import {
  fetchCpcb,
  fetchForecast,
  fetchOpenAq,
  reconcileOpenAq,
} from './providers.mjs'
import { policyFor } from './policies.mjs'
import { indexStations, nearbyStations, stationIdentity } from './spatial.mjs'
import { retainRun } from './history.mjs'

function retrievedAt(value) {
  const times = [
    value?.forecast?.fetchedAt,
    ...(value?.monitors || []).map((monitor) => monitor.fetchedAt),
  ].filter((at) => at && Number.isFinite(Date.parse(at)))
  return times.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null
}

function lastSuccessAt(data) {
  if (data && Object.hasOwn(data, 'lastSuccessAt'))
    return data.lastSuccessAt ?? null
  if (data?.status && Object.hasOwn(data.status, 'lastSuccessAt'))
    return data.status.lastSuccessAt ?? null
  return retrievedAt(data?.value)
}

function observedTime(monitor) {
  const at = Date.parse(monitor.observedAt)
  return Number.isFinite(at) ? at : Number.MIN_SAFE_INTEGER
}

export function createEngine({ store, request, keys, enqueue, archive }) {
  async function enabled() {
    return (
      process.env.INGESTION_ENABLED !== 'false' &&
      !(await store.get('CONTROL'))?.data?.paused
    )
  }
  async function demand(area) {
    const existing = await store.get('DEMAND', area.id)
    if (!existing || existing.expireAt <= Date.now() / 1000) {
      if (!(await store.claim('ADMISSION', 10))) return false
      try {
        const active = (await store.list('DEMAND', 100)).filter(
          (row) => row.expireAt > Date.now() / 1000,
        )
        if (active.length >= Number(process.env.MAX_ACTIVE_AREAS || 20))
          return false
        await store.put('DEMAND', area.id, area, {
          expireAt: Math.floor(Date.now() / 1000) + 86400,
        })
      } finally {
        await store.delete('ADMISSION', 'lock')
      }
    } else
      await store.put(
        'DEMAND',
        area.id,
        {
          ...existing.data,
          city: area.city || existing.data.city,
          state: area.state || existing.data.state,
        },
        { expireAt: Math.floor(Date.now() / 1000) + 86400 },
      )
    return true
  }
  async function schedule(area) {
    if (!(await enabled())) return false
    if ((await store.get('QUEUE_STATUS'))?.data.until > Date.now()) return false
    const rows = await Promise.all(
      ['forecast', 'openaq', 'cpcb'].map((provider) =>
        store.get(`SOURCE#${area.id}`, provider),
      ),
    )
    if (rows.every((row) => row?.refreshAt > Date.now())) return false
    if (!(await store.claim(`QUEUE#${area.id}`, 60))) return false
    try {
      await enqueue({ type: 'refresh', area })
      return true
    } catch {
      await store.delete(`QUEUE#${area.id}`, 'lock')
      await store.put('QUEUE_STATUS', 'current', {
        until: Date.now() + 60000,
        message:
          'Refresh scheduling is temporarily unavailable. Existing evidence remains visible.',
      })
      console.warn(JSON.stringify({ event: 'refresh_queue_unavailable' }))
      return false
    }
  }
  async function dashboard(place, date) {
    const area = areaFor(place),
      admitted = await demand(area)
    const queued = admitted ? await schedule(area) : false
    const inFlight =
      queued ||
      (await store.get(`WORKER#${area.id}`, 'lock'))?.until > Date.now() ||
      (await store.get(`QUEUE#${area.id}`, 'lock'))?.until > Date.now()
    const [forecastRow, cpcb, openaq, policy] = await Promise.all([
      store.get(`SOURCE#${area.id}`, 'forecast'),
      store.get(`SOURCE#${area.id}`, 'cpcb'),
      store.get(`SOURCE#${area.id}`, 'openaq'),
      policyFor(place, date),
    ])
    const forecast = forecastRow?.data?.value?.forecast || null
    const source = (row, provider) => ({
      ...(row?.data?.status || {
        status: inFlight ? 'pending' : 'unavailable',
        message: admitted
          ? `${provider} data has not been retrieved yet.`
          : 'This pilot has reached its active-area capacity. Existing evidence remains available; try again later.',
      }),
      lastAttemptAt:
        row?.data?.lastAttemptAt ?? row?.data?.status?.lastAttemptAt ?? null,
      lastSuccessAt: lastSuccessAt(row?.data),
    })
    const candidates = [
      ...(cpcb?.data?.value?.monitors || []),
      ...(openaq?.data?.value?.monitors || []),
      ...(await nearbyStations(store, place)),
    ]
    const unique = new Map()
    for (const input of candidates) {
      const monitor = stationIdentity(input)
      const key = `${monitor.source}:${monitor.providerStationId}:${monitor.sensorId}`
      if (
        !unique.has(key) ||
        Date.parse(monitor.fetchedAt) > Date.parse(unique.get(key).fetchedAt)
      )
        unique.set(key, monitor)
    }
    const monitors = [...unique.values()]
      .map((monitor) => ({
        ...monitor,
        distanceKm: distanceKm(
          place.latitude,
          place.longitude,
          monitor.latitude,
          monitor.longitude,
        ),
        stale: sourceAge(monitor.observedAt) !== 'current',
      }))
      .filter((monitor) => monitor.distanceKm <= 25)
      .sort(
        (a, b) =>
          Number(a.stale) - Number(b.stale) ||
          Number(a.qualityFlags?.length > 0) -
            Number(b.qualityFlags?.length > 0) ||
          a.distanceKm - b.distanceKm ||
          observedTime(b) - observedTime(a),
      )
    const selected = ['CPCB / data.gov.in', 'OpenAQ'].flatMap((provider) => {
      const match = monitors.find((monitor) => monitor.source === provider)
      return match ? [match] : []
    })
    const sources = {
      forecast: source(forecastRow, 'Forecast'),
      cpcb: source(cpcb, 'CPCB'),
      openaq: source(openaq, 'OpenAQ'),
    }
    const evidence = {
      area: area.id,
      jurisdiction: {
        name: place.detected ? '' : place.name,
        state: place.detected ? '' : place.state,
      },
      date,
      forecastId: forecast?.id || null,
      forecastFetchedAt: forecast?.fetchedAt || null,
      observations: selected.map((monitor) => ({
        id: monitor.id,
        observedAt: monitor.observedAt,
        unit: monitor.unit,
        period: monitor.period,
        value: monitor.value,
        statistic: monitor.statistic,
        station: monitor.station,
        source: monitor.source,
        originId: monitor.originId,
      })),
      policyVersion: policy.version,
      policyStatus: policy.status,
    }
    const snapshotId = hash(evidence)
    if (!(await store.get(`EVIDENCE#${snapshotId}`)))
      await store.put(
        `EVIDENCE#${snapshotId}`,
        'current',
        { ...evidence, recordedAt: new Date().toISOString() },
        { expireAt: Math.floor(Date.now() / 1000) + 90 * 86400 },
      )
    const hasCurrent = selected.some((monitor) => !monitor.stale)
    const pending =
      queued ||
      Object.values(sources).some((entry) => entry.status === 'pending')
    return {
      schemaVersion: 2,
      snapshotId,
      location: place,
      forecast,
      monitors: selected,
      nearbyMonitors: monitors.slice(0, 10),
      sources,
      policy,
      pending,
      coverage: {
        state: forecast
          ? hasCurrent
            ? 'forecast_and_observation'
            : selected.length
              ? 'forecast_and_old_observation'
              : 'forecast_only'
          : selected.length
            ? 'observations_only'
            : pending
              ? 'pending'
              : 'unavailable',
        returnedStationCount: new Set(
          monitors.map(
            (monitor) =>
              monitor.canonicalStationId ||
              `${monitor.source}:${monitor.providerStationId}`,
          ),
        ).size,
        nearestDistanceKm: monitors.length
          ? Math.min(...monitors.map((monitor) => monitor.distanceKm))
          : null,
        searchRadiusKm: 25,
        catalogAt:
          (await store.get(`REGISTRY#${area.id}`))?.data?.fetchedAt || null,
        message:
          'Counts describe returned usable stations, not complete national coverage or conditions at your building.',
      },
      comparison:
        selected.length === 2 ? comparable(selected[0], selected[1]) : null,
      ingestionPaused: !(await enabled()),
      ingestionWarning:
        (await store.get('QUEUE_STATUS'))?.data.until > Date.now()
          ? 'Refresh scheduling is temporarily unavailable. Existing evidence remains visible.'
          : null,
    }
  }
  async function refresh(area) {
    if (!area || !/^-?\d+\.\d,-?\d+\.\d$/.test(area.id))
      throw new ApiError('Refresh area is invalid.')
    if (!(await enabled()) || !(await store.claim(`WORKER#${area.id}`, 180)))
      return
    try {
      const secret = await keys()
      const deadline = Date.now() + 145000
      const boundedRequest = (...args) => {
        if (Date.now() > deadline)
          throw new ApiError(
            'Refresh time budget reached. Remaining sources will retry.',
            503,
          )
        return request(...args)
      }
      for (const [provider, adapter, interval] of [
        ['forecast', fetchForecast, 3600000],
        ['openaq', fetchOpenAq, 900000],
        ['cpcb', fetchCpcb, 900000],
      ]) {
        const previous = await store.get(`SOURCE#${area.id}`, provider)
        if (previous?.refreshAt > Date.now()) continue
        const attemptAt = new Date().toISOString()
        try {
          let result
          const alias =
            provider === 'forecast'
              ? (await store.get(`GRID_ALIAS#${area.id}`))?.data
              : null
          const shared = alias ? await store.get(`GRID#${alias.id}`) : null
          const fromShared =
            shared &&
            Date.now() - Date.parse(shared.data.forecast.fetchedAt) < 3600000
          if (fromShared) result = shared.data
          else
            result =
              provider === 'forecast'
                ? await adapter(area, boundedRequest, secret)
                : provider === 'openaq'
                  ? await adapter(area, boundedRequest, store, secret)
                  : await adapter(area, boundedRequest, secret)
          const hasReadings = Boolean(
            result.forecast || result.monitors?.length,
          )
          const successfulAt = retrievedAt(result)
          const previousSuccessAt = lastSuccessAt(previous?.data)
          const successAt =
            hasReadings &&
            ['live', 'stale'].includes(result.status.status) &&
            successfulAt &&
            (!previousSuccessAt ||
              Date.parse(successfulAt) > Date.parse(previousSuccessAt))
              ? successfulAt
              : previousSuccessAt
          await store.put(
            `SOURCE#${area.id}`,
            provider,
            {
              value: hasReadings ? result : previous?.data?.value || result,
              status: result.status,
              lastAttemptAt: attemptAt,
              lastSuccessAt: successAt,
            },
            {
              refreshAt: Date.now() + interval,
              expireAt: Math.floor(Date.now() / 1000) + 7 * 86400,
            },
          )
          if (result.monitors) await indexStations(store, result.monitors)
          if (provider === 'forecast' && result.forecast) {
            try {
              await retainRun(store, area, result.forecast)
              await store.put(
                `RUN_STATUS#${area.id}`,
                'current',
                { status: 'retained', checkedAt: new Date().toISOString() },
                { expireAt: Math.floor(Date.now() / 1000) + 90 * 86400 },
              )
            } catch {
              console.warn(
                JSON.stringify({ event: 'retained_run_index_failed' }),
              )
              await store
                .put(
                  `RUN_STATUS#${area.id}`,
                  'current',
                  {
                    status: 'incomplete',
                    message:
                      'Some model runs could not be indexed. The current forecast is independent; missing history is not filled.',
                    checkedAt: new Date().toISOString(),
                  },
                  { expireAt: Math.floor(Date.now() / 1000) + 90 * 86400 },
                )
                .catch(() => {})
            }
          }
          if (provider === 'forecast' && result.forecast && !fromShared) {
            const gridId = hash(result.forecast.grid)
            await store.put(`GRID_ALIAS#${area.id}`, 'current', { id: gridId })
            await store.put(`GRID#${gridId}`, 'current', result, {
              expireAt: Math.floor(Date.now() / 1000) + 7 * 86400,
            })
            await store.replace(
              `FORECAST#${result.forecast.id}`,
              'current',
              result.forecast,
              0,
              { expireAt: Math.floor(Date.now() / 1000) + 90 * 86400 },
            )
            try {
              await archive('forecast', {
                normalized: result.forecast,
                raw: result.raw,
              })
              await store.put('ARCHIVE_STATUS', 'forecast', {
                status: 'stored',
                at: new Date().toISOString(),
              })
            } catch {
              await store.put('ARCHIVE_STATUS', 'forecast', {
                status: 'failed',
                at: new Date().toISOString(),
              })
              console.warn(
                JSON.stringify({ event: 'archive_failed', kind: 'forecast' }),
              )
            }
          }
        } catch (error) {
          await store.put(
            `SOURCE#${area.id}`,
            provider,
            {
              value: previous?.data?.value || null,
              status: {
                status: 'unavailable',
                message:
                  error instanceof ApiError
                    ? error.message
                    : 'Provider processing failed. Last available evidence is preserved.',
              },
              lastAttemptAt: attemptAt,
              lastSuccessAt: lastSuccessAt(previous?.data),
            },
            {
              refreshAt: Date.now() + 120000,
              expireAt: Math.floor(Date.now() / 1000) + 7 * 86400,
            },
          )
          console.warn(
            JSON.stringify({
              event: 'provider_refresh_failed',
              provider,
              status: error.status || 502,
            }),
          )
        }
      }
      try {
        const history = await reconcileOpenAq(
          area,
          boundedRequest,
          store,
          secret,
        )
        if (history.records.length && process.env.ARCHIVE_OPENAQ === 'true')
          await archive('observation', { records: history.records })
        if (!history.skipped)
          await store.put(`HISTORY_STATUS#${area.id}`, 'current', {
            status: history.partial ? 'partial' : 'checked',
            checkedAt: new Date().toISOString(),
            records: history.records.length,
          })
      } catch {
        await store.delete(`HISTORY#${area.id}`, 'lock')
        await store.put(`HISTORY_STATUS#${area.id}`, 'current', {
          status: 'incomplete',
          message: 'History reconciliation failed and will be retried.',
        })
      }
    } finally {
      await store.delete(`WORKER#${area.id}`, 'lock')
    }
  }
  async function dispatch() {
    if (!(await enabled())) return
    for (const row of await store.list('DEMAND', 100))
      if (row.expireAt > Date.now() / 1000) await schedule(row.data)
  }
  return { dashboard, refresh, dispatch }
}
