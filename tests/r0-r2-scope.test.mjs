import assert from 'node:assert/strict'
import test from 'node:test'
import { handler } from '../api/handler.mjs'
import { capabilities, releaseScope } from '../api/capabilities.mjs'
import { createContext } from '../api/context.mjs'
import { evaluateDue } from '../api/alert-dispatcher.mjs'

// Explicit synthetic deployment settings. No providers, credentials, auth tokens
// or existing local planning data are accessed by these disabled-scope checks.
const enableOptional = {
  SHARED_WORKSPACES_ENABLED: 'true',
  REVIEW_EMAIL_ENABLED: 'true',
  NOTIFICATION_SENDER: 'synthetic@example.test',
  PUBLIC_EVIDENCE_ENABLED: 'true',
  PUBLIC_REDISTRIBUTION_REVIEWED: 'true',
  WEATHER_ENABLED: 'true',
  FIRES_ENABLED: 'true',
  FIRMS_PRODUCT_VERIFIED: 'true',
  COGNITO_USER_POOL_ID: 'ap-south-1_Synthetic',
  COGNITO_CLIENT_ID: 'synthetic-client',
  COGNITO_DOMAIN: 'synthetic.auth.ap-south-1.amazoncognito.com',
}
function settings(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
    t.after(() => {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    })
  }
}
test('R0-R2 is the fail-closed default even when old optional flags are present', (t) => {
  settings(t, { ...enableOptional, RELEASE_SCOPE: undefined })
  assert.equal(releaseScope(), 'R0R2')
  const caps = capabilities()
  for (const key of [
    'sharedWorkspaces',
    'localGroups',
    'reviewEmail',
    'weather',
    'fires',
    'publicEvidence',
  ])
    assert.equal(caps[key], false)
  assert.ok(Object.values(caps.r4).every((value) => value === false))
  assert.ok(Object.values(caps.r5).every((value) => value === false))
})
test('an unrecognized release scope cannot silently activate a full release', (t) => {
  settings(t, { ...enableOptional, RELEASE_SCOPE: 'full-typo' })
  assert.equal(capabilities().sharedWorkspaces, false)
  assert.equal(capabilities().r4.localJourneys, false)
})
test('R0-R2 config hides unused auth identity and email configuration', async (t) => {
  settings(t, { ...enableOptional, RELEASE_SCOPE: 'R0R2' })
  const result = await handler({ rawPath: '/api/config', headers: {} })
  const config = JSON.parse(result.body)
  assert.equal(result.statusCode, 200)
  assert.equal(config.releaseScope, 'R0R2')
  assert.equal(config.userPoolId, null)
  assert.equal(config.clientId, null)
  assert.equal(config.authDomain, null)
  assert.equal(config.notificationConfigured, false)
  assert.equal(config.capabilities.localGroups, false)
  assert.equal(config.contracts.history, 1)
})
test('paused and deferred routes reject before body parsing, auth and provider/storage work', async (t) => {
  settings(t, { ...enableOptional, RELEASE_SCOPE: 'R0R2' })
  for (const path of [
    '/api/workspace',
    '/api/workspace/decisions',
    '/api/workspace/devices',
    '/api/workspace/integrations',
    '/api/groups',
    '/api/preferences/subscriptions',
    '/api/unsubscribe',
    '/api/public/evidence',
    '/api/public/widget',
    '/api/context/weather',
    '/api/context/fires',
  ]) {
    const result = await handler({
      rawPath: path,
      httpMethod: 'POST',
      body: 'not-json',
      headers: {},
    })
    assert.equal(result.statusCode, 404, path)
    assert.match(JSON.parse(result.body).error, /disabled/)
  }
})
test('Full scope alone does not activate staff accounts or scheduled email', async (t) => {
  settings(t, {
    ...enableOptional,
    RELEASE_SCOPE: 'Full',
    SHARED_WORKSPACES_ENABLED: 'false',
  })
  assert.equal(capabilities().sharedWorkspaces, false)
  assert.equal(capabilities().reviewEmail, false)
  const result = await handler({
    rawPath: '/api/groups',
    httpMethod: 'POST',
    headers: {},
  })
  assert.equal(result.statusCode, 404)
})
test('explicit Full/shared scope preserves separately enabled capability semantics', async (t) => {
  settings(t, { ...enableOptional, RELEASE_SCOPE: 'Full' })
  const caps = capabilities()
  assert.equal(caps.sharedWorkspaces, true)
  assert.equal(caps.localGroups, true)
  assert.equal(caps.reviewEmail, true)
  assert.equal(caps.publicEvidence, true)
  assert.equal(caps.weather, true)
  assert.equal(caps.fires, true)
  assert.equal(caps.r4.localJourneys, true)
  const config = JSON.parse(
    (await handler({ rawPath: '/api/config', headers: {} })).body,
  )
  assert.equal(config.userPoolId, enableOptional.COGNITO_USER_POOL_ID)
})
test('Full/shared scope still requires each optional capability prerequisite', async (t) => {
  settings(t, {
    ...enableOptional,
    RELEASE_SCOPE: 'Full',
    REVIEW_EMAIL_ENABLED: 'false',
    PUBLIC_REDISTRIBUTION_REVIEWED: 'false',
    FIRMS_PRODUCT_VERIFIED: 'false',
    WEATHER_ENABLED: 'false',
  })
  const caps = capabilities()
  assert.equal(caps.sharedWorkspaces, true)
  assert.equal(caps.reviewEmail, false)
  assert.equal(caps.publicEvidence, false)
  assert.equal(caps.fires, false)
  assert.equal(caps.weather, false)
  for (const path of [
    '/api/unsubscribe',
    '/api/public/evidence',
    '/api/context/fires',
    '/api/context/weather',
  ]) {
    assert.equal(
      (await handler({ rawPath: path, headers: {} })).statusCode,
      404,
    )
  }
})
test('R0-R2 context reads and scheduler remain disabled despite stale optional environment flags', async (t) => {
  settings(t, { ...enableOptional, RELEASE_SCOPE: 'R0R2' })
  const fail = () => {
    throw new Error('No optional storage, network or queue work is allowed')
  }
  const context = createContext({
    store: { get: fail },
    engine: { dashboard: fail },
    request: fail,
    keys: fail,
    enqueue: fail,
    archive: fail,
  })
  const place = { latitude: 28.6, longitude: 77.2 }
  assert.equal(
    (await context.read(place, '2026-10-11', 'weather')).status,
    'disabled',
  )
  assert.equal(
    (await context.read(place, '2026-10-11', 'fires')).status,
    'disabled',
  )
  await evaluateDue({ range: fail }, { dashboard: fail }, fail)
})
