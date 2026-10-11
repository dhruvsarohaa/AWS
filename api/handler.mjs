import {
  ApiError,
  hash,
  placeFromParams,
  publicError,
  validDate,
} from './core.mjs'
import { runtime } from './runtime.mjs'
import { makeTransport } from './transport.mjs'
import { credentials } from './services.mjs'
import { membership, workspaceRoute } from './workspaces.mjs'
import { historyRoute } from './history.mjs'
import { capabilities, releaseScope } from './capabilities.mjs'
import { publicEvidence, widgetResponse } from './public-evidence.mjs'
import { unsubscribe, subscriptionsRoute } from './subscriptions.mjs'
import { groupsRoute } from './groups.mjs'
import { r4Route } from './r4-integrations.mjs'
import { integrationAdapters } from './pilot-config.mjs'

function requestBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '{}'
  if (Buffer.byteLength(raw) > 64000)
    throw new ApiError('Request is too large.', 413)
  try {
    const body = JSON.parse(raw)
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error()
    return body
  } catch {
    throw new ApiError('Request must contain a JSON object.')
  }
}

export function response(statusCode, body, origin) {
  const allowed = process.env.ALLOWED_ORIGIN || 'http://localhost:5174'
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      vary: 'Origin',
      ...(origin === allowed
        ? {
            'access-control-allow-origin': allowed,
            'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
            'access-control-allow-headers': 'content-type,authorization',
          }
        : {}),
    },
    body: statusCode === 204 ? '' : JSON.stringify(body),
  }
}
export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin,
    method = event.requestContext?.http?.method || event.httpMethod || 'GET'
  const path = event.rawPath || event.path || '/',
    params = new URLSearchParams(event.rawQueryString || '')
  for (const [key, value] of Object.entries(event.queryStringParameters || {}))
    if (value != null && !params.has(key)) params.set(key, value)
  if (method === 'OPTIONS') return response(204, {}, origin)
  try {
    const enabled = capabilities()
    if (method === 'GET' && path === '/api/health')
      return response(
        200,
        {
          ok: true,
          version: 2,
          storage: process.env.EVIDENCE_TABLE ? 'dynamodb' : 'local-file',
          fixtures: false,
        },
        origin,
      )
    if (method === 'GET' && path === '/api/config')
      return response(
        200,
        {
          userPoolId: enabled.sharedWorkspaces
            ? process.env.COGNITO_USER_POOL_ID || null
            : null,
          clientId: enabled.sharedWorkspaces
            ? process.env.COGNITO_CLIENT_ID || null
            : null,
          authDomain: enabled.sharedWorkspaces
            ? process.env.COGNITO_DOMAIN || null
            : null,
          notificationConfigured: enabled.reviewEmail,
          scope: 'India outdoor planner',
          releaseScope: releaseScope(),
          schemaVersion: 2,
          contracts: {
            dashboard: 2,
            history: 1,
            pollutantSeries: 1,
            localPlanning: 2,
          },
          capabilities: enabled,
        },
        origin,
      )
    // Scope checks run before runtime/storage, authentication, provider secrets
    // or any queued work. Hiding a control alone would leave its API reachable.
    if (
      (path.startsWith('/api/workspace') && !enabled.sharedWorkspaces) ||
      (path === '/api/groups' && !enabled.sharedWorkspaces) ||
      (['/api/preferences/subscriptions', '/api/unsubscribe'].includes(path) &&
        !enabled.reviewEmail) ||
      (['/api/public/evidence', '/api/public/widget'].includes(path) &&
        !enabled.publicEvidence) ||
      (path === '/api/context/weather' && !enabled.weather) ||
      (path === '/api/context/fires' && !enabled.fires)
    )
      throw new ApiError(
        'This capability is disabled for the selected release.',
        404,
      )
    const { store, engine, context, devices } = await runtime()
    if (path === '/api/unsubscribe') {
      if (method !== 'POST')
        throw new ApiError('Confirm unsubscribe using POST.', 405)
      return response(
        200,
        await unsubscribe(requestBody(event).token, store),
        origin,
      )
    }
    if (path === '/api/preferences/subscriptions' || path === '/api/groups') {
      const member = await membership(event, store)
      return response(
        200,
        await (path === '/api/groups' ? groupsRoute : subscriptionsRoute)(
          method,
          requestBody(event),
          member,
          store,
        ),
        origin,
      )
    }
    if (path.startsWith('/api/workspace')) {
      const member = await membership(event, store)
      const body = requestBody(event)
      if (
        path === '/api/workspace/devices' ||
        path.startsWith('/api/workspace/devices/')
      )
        return response(
          200,
          await devices.route(method, path, body, member),
          origin,
        )
      if (
        path === '/api/workspace/integrations' ||
        path.startsWith('/api/workspace/integrations/')
      )
        return response(
          200,
          await r4Route(method, path, body, member, store, {
            adapters: integrationAdapters,
          }),
          origin,
        )
      return response(
        200,
        await workspaceRoute(method, path, body, member, store),
        origin,
      )
    }
    if (method !== 'GET')
      throw new ApiError('This route supports GET requests only.', 405)
    if (path === '/api/public/evidence' || path === '/api/public/widget') {
      const evidence = await publicEvidence(params, engine, store)
      return path.endsWith('/widget')
        ? widgetResponse(evidence)
        : response(200, evidence, origin)
    }
    if (path === '/api/context/weather' || path === '/api/context/fires')
      return response(
        200,
        await context.read(
          placeFromParams(params),
          params.get('date'),
          path.split('/').at(-1),
        ),
        origin,
      )
    if (path === '/api/search') {
      const query = params.get('q')?.trim()
      if (!query || query.length > 80)
        throw new ApiError(
          'Enter an Indian city or town (up to 80 characters).',
        )
      const key = `SEARCH#${hash(query.toLowerCase())}`,
        previous = await store.get(key)
      if (previous?.expireAt > Date.now() / 1000)
        return response(200, { results: previous.data }, origin)
      const secret = await credentials(),
        url = new URL(
          secret.OPEN_METEO_API_KEY
            ? 'https://customer-geocoding-api.open-meteo.com/v1/search'
            : 'https://geocoding-api.open-meteo.com/v1/search',
        )
      for (const [name, value] of Object.entries({
        name: query,
        count: 10,
        language: 'en',
        countryCode: 'IN',
      }))
        url.searchParams.set(name, value)
      if (secret.OPEN_METEO_API_KEY)
        url.searchParams.set('apikey', secret.OPEN_METEO_API_KEY)
      const payload = await makeTransport(store)('openmeteo', url)
      const results = (payload.results || [])
        .filter((place) => place.country_code === 'IN')
        .map((place) => ({
          name: place.name,
          state: place.admin1 || '',
          country: 'India',
          latitude: place.latitude,
          longitude: place.longitude,
        }))
      await store.put(key, 'current', results, {
        expireAt: Math.floor(Date.now() / 1000) + 86400,
      })
      return response(200, { results }, origin)
    }
    if (path === '/api/history')
      return response(
        200,
        await historyRoute(params, placeFromParams(params), store),
        origin,
      )
    if (path === '/api/dashboard') {
      const place = placeFromParams(params),
        date =
          params.get('date') ||
          new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' })
      if (!validDate(date)) throw new ApiError('Plan date is invalid.')
      const today = new Date().toLocaleDateString('sv-SE', {
          timeZone: 'Asia/Kolkata',
        }),
        lastDate = new Date(Date.parse(`${today}T12:00:00Z`) + 2 * 86400000)
          .toISOString()
          .slice(0, 10)
      if (date < today || date > lastDate)
        throw new ApiError('Choose today or either of the next two days.')
      return response(200, await engine.dashboard(place, date), origin)
    }
    throw new ApiError('API route not found.', 404)
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: 'api_request_failed',
        status: error.status || 503,
      }),
    )
    return response(
      error instanceof ApiError ? error.status : 503,
      {
        error: publicError(error),
        ...(error.code === 'workspace_membership_revoked'
          ? { code: error.code }
          : {}),
      },
      origin,
    )
  }
}
