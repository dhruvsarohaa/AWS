import { ApiError } from './core.mjs'

const LIMITS = {
  openmeteo: [40, 500, 5000],
  openaq: [40, 1400, 20000],
  cpcb: [8, 80, 1000],
  weather: [5, 30, 500],
  firms: [2, 20, 100],
}
export async function quota(store, provider, now = Date.now()) {
  const limits = LIMITS[provider]
  if (!limits) throw new Error('Unknown provider')
  for (const [index, duration] of [60000, 3600000, 86400000].entries()) {
    const window = Math.floor(now / duration)
    if (
      !(await store.increment(
        `QUOTA#${provider}#${duration}#${window}`,
        limits[index],
        Math.ceil(((window + 1) * duration) / 1000) + 86400,
      ))
    )
      throw new ApiError(
        'Provider request budget is temporarily exhausted. Last available data is preserved.',
        429,
      )
  }
}
export function makeTransport(store, fetcher = fetch) {
  return async function request(provider, url, options = {}) {
    const circuit = await store.get(`CIRCUIT#${provider}`)
    if (circuit?.data?.until > Date.now())
      throw new ApiError(
        'Provider is cooling down after errors. Last available data is preserved.',
        503,
      )
    const allowed = new Set([
      'air-quality-api.open-meteo.com',
      'geocoding-api.open-meteo.com',
      'customer-air-quality-api.open-meteo.com',
      'customer-geocoding-api.open-meteo.com',
      'api.openaq.org',
      'api.data.gov.in',
      'api.open-meteo.com',
      'customer-api.open-meteo.com',
      'firms.modaps.eosdis.nasa.gov',
    ])
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' ||
      !allowed.has(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== '443')
    )
      throw new Error('Upstream host is not allowed')
    const expectedHosts = {
      openmeteo: [
        'air-quality-api.open-meteo.com',
        'customer-air-quality-api.open-meteo.com',
        'geocoding-api.open-meteo.com',
        'customer-geocoding-api.open-meteo.com',
      ],
      openaq: ['api.openaq.org'],
      cpcb: ['api.data.gov.in'],
      weather: ['api.open-meteo.com', 'customer-api.open-meteo.com'],
      firms: ['firms.modaps.eosdis.nasa.gov'],
    }
    if (!expectedHosts[provider]?.includes(parsed.hostname))
      throw new Error('Provider host does not match its budget')
    const { responseType, ...fetchOptions } = options
    for (let attempt = 0; attempt < 2; attempt++) {
      await quota(store, provider)
      try {
        const response = await fetcher(parsed, {
          ...fetchOptions,
          redirect: 'error',
          signal: AbortSignal.timeout(8000),
          headers: { accept: 'application/json', ...options.headers },
        })
        if (!response.ok) {
          if (response.status === 429) {
            const retry = response.headers.get('retry-after'),
              reset = response.headers.get('x-ratelimit-reset')
            const retryDelay = retry
              ? Number.isFinite(Number(retry))
                ? Number(retry) * 1000
                : Date.parse(retry) - Date.now()
              : reset
                ? Number(reset) > 1000000000
                  ? Number(reset) * 1000 - Date.now()
                  : Number(reset) * 1000
                : 60000
            const delay = Math.min(
              3600000,
              Math.max(60000, Number.isFinite(retryDelay) ? retryDelay : 60000),
            )
            await store.put(`CIRCUIT#${provider}`, 'current', {
              until: Date.now() + delay,
            })
            throw new ApiError(
              'Provider rate limit reached. Its data will be retried after the reset.',
              429,
            )
          }
          if (response.status === 401 || response.status === 403)
            throw new ApiError(
              'Provider credentials are missing, expired, or not permitted.',
              503,
            )
          throw new ApiError(`Provider returned HTTP ${response.status}.`, 502)
        }
        const reader = response.body?.getReader(),
          chunks = []
        let size = 0
        if (!reader)
          throw new ApiError('Provider returned no response body.', 502)
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 4000000) {
            await reader.cancel()
            throw new ApiError('Provider response exceeds our size limit.', 502)
          }
          chunks.push(value)
        }
        const raw = Buffer.concat(chunks).toString('utf8')
        const body = responseType === 'text' ? raw : JSON.parse(raw)
        await store.delete(`CIRCUIT#${provider}`)
        return body
      } catch (error) {
        if (error instanceof ApiError && [429, 503].includes(error.status))
          throw error
        if (attempt === 1) {
          await store.put(`CIRCUIT#${provider}`, 'current', {
            until: Date.now() + 60000,
          })
          throw new ApiError(
            error instanceof ApiError
              ? error.message
              : 'Provider timed out or returned invalid data.',
            502,
          )
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 100 + Math.random() * 200),
        )
      }
    }
  }
}
