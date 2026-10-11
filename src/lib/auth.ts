import { createRequestScope } from './requestScope.ts'

export type AuthConfig = {
  clientId: string | null
  authDomain: string | null
  notificationConfigured: boolean
  capabilities?: {
    reviewEmail: boolean
    publicEvidence: boolean
    weather: boolean
    fires: boolean
    r4?: { localJourneys: boolean; explanationAssistant: boolean; routeComparison: boolean; wearableSync: boolean; indianPollen: boolean; denseAirMap: boolean }
    r5?: { indoorDevices: boolean; deviceControls: boolean; deviceAutomation: boolean; siteControls: boolean }
  }
}
const API = import.meta.env?.VITE_API_BASE_URL || ''
const sessionRequests = createRequestScope()
type SessionEndReason = 'signed-out' | 'expired' | 'revoked'
const sessionEndListeners = new Set<(reason: SessionEndReason) => void>()
const sessionStartListeners = new Set<() => void>()
export function onSessionStart(listener: () => void) {
  sessionStartListeners.add(listener)
  return () => { sessionStartListeners.delete(listener) }
}
export const captureSession = () => sessionRequests.capture()
export function onSessionEnd(listener: (reason: SessionEndReason) => void) {
  sessionEndListeners.add(listener)
  return () => {
    sessionEndListeners.delete(listener)
  }
}
function requireCurrentSession(
  session: ReturnType<typeof captureSession>,
  signal?: AbortSignal,
) {
  if (!session.isCurrent() || signal?.aborted)
    throw new DOMException('Workspace request was cancelled.', 'AbortError')
}
const base64url = (buffer: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
export async function signIn(config: AuthConfig) {
  if (!config.clientId || !config.authDomain)
    throw new Error('Shared sign-in is not configured.')
  const session = captureSession(),
    verifier = base64url(crypto.getRandomValues(new Uint8Array(48))),
    state = crypto.randomUUID()
  sessionStorage.setItem(
    'airday-oauth',
    JSON.stringify({ verifier, state, createdAt: Date.now() }),
  )
  const challenge = base64url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  )
  requireCurrentSession(session)
  const url = new URL(`https://${config.authDomain}/oauth2/authorize`)
  for (const [key, value] of Object.entries({
    client_id: config.clientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: `${window.location.origin}/`,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }))
    url.searchParams.set(key, value)
  window.location.assign(url)
}
let completing: Promise<void> | null = null
export function finishSignIn(config: AuthConfig) {
  return (completing ||= exchangeCode(config))
}
async function exchangeCode(config: AuthConfig) {
  const session = captureSession()
  const params = new URLSearchParams(window.location.search)
  if (!params.has('code') && !params.has('error')) return
  const stored = JSON.parse(sessionStorage.getItem('airday-oauth') || 'null')
  sessionStorage.removeItem('airday-oauth')
  history.replaceState({}, '', window.location.pathname)
  if (params.has('error'))
    throw new Error('Sign-in was cancelled or could not complete.')
  if (
    !stored ||
    stored.state !== params.get('state') ||
    Date.now() - stored.createdAt > 600000
  )
    throw new Error('Sign-in state expired or did not match. Try again.')
  const response = await fetch(`https://${config.authDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.any([session.signal, AbortSignal.timeout(15000)]),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId!,
      code: params.get('code')!,
      redirect_uri: `${window.location.origin}/`,
      code_verifier: stored.verifier,
    }),
  })
  requireCurrentSession(session)
  if (!response.ok) throw new Error('Sign-in token exchange failed. Try again.')
  const body = await response.json()
  requireCurrentSession(session)
  if (!body.access_token || !Number.isFinite(body.expires_in))
    throw new Error('Sign-in returned an invalid response.')
  sessionRequests.invalidate()
  sessionStorage.setItem(
    'airday-session',
    JSON.stringify({
      accessToken: body.access_token,
      until: Date.now() + body.expires_in * 1000,
    }),
  )
  for (const listener of sessionStartListeners) listener()
}
export function signedIn() {
  try {
    const stored = JSON.parse(
      sessionStorage.getItem('airday-session') || 'null',
    )
    return Boolean(stored?.accessToken && stored.until > Date.now())
  } catch {
    return false
  }
}
export function signOut() {
  endSession('signed-out')
}
function endSession(reason: SessionEndReason) {
  sessionRequests.invalidate()
  completing = null
  sessionStorage.removeItem('airday-session')
  sessionStorage.removeItem('airday-oauth')
  for (const listener of sessionEndListeners) listener(reason)
}
export async function workspaceRequest(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
) {
  const session = captureSession()
  requireCurrentSession(session, signal)
  if (!signedIn()) {
    endSession('expired')
    throw new Error('Sign in again to use your workspace.')
  }
  const stored = JSON.parse(sessionStorage.getItem('airday-session') || 'null')
  const response = await fetch(`${API}/api/workspace${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${stored.accessToken}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.any([
      session.signal,
      AbortSignal.timeout(15000),
      ...(signal ? [signal] : []),
    ]),
  })
  requireCurrentSession(session, signal)
  if (response.status === 401) {
    endSession('expired')
    throw new Error('Sign in again to use your workspace.')
  }
  const result = await response.json()
  requireCurrentSession(session, signal)
  if (response.status === 403 && result.code === 'workspace_membership_revoked') {
    endSession('revoked')
    throw new Error('Workspace membership was revoked. Contact its owner before signing in again.')
  }
  if (!signedIn()) {
    endSession('expired')
    throw new Error('Sign in again to use your workspace.')
  }
  if (!response.ok) throw new Error(result.error || 'Workspace request failed.')
  return result
}
