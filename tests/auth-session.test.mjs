import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureSession,
  onSessionEnd,
  signedIn,
  signOut,
  workspaceRequest,
} from '../src/lib/auth.ts'
import { createRequestScope } from '../src/lib/requestScope.ts'

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(t) {
  const values = new Map(),
    originalStorage = globalThis.sessionStorage,
    originalFetch = globalThis.fetch
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  signOut()
  t.after(() => {
    if (originalStorage === undefined) delete globalThis.sessionStorage
    else globalThis.sessionStorage = originalStorage
    globalThis.fetch = originalFetch
  })
  const signInLocally = (token = 'offline-test-session') => {
    sessionStorage.setItem(
      'airday-session',
      JSON.stringify({ accessToken: token, until: Date.now() + 60000 }),
    )
  }
  signInLocally()
  return { signInLocally }
}

const response = (value, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => value,
})

test('current session requests can still return workspace data', async (t) => {
  setup(t)
  const value = { membership: { workspaceId: 'offline-test-workspace' } }
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/workspace')
    assert.equal(options.headers.authorization, 'Bearer offline-test-session')
    assert.equal(options.signal.aborted, false)
    return response(value)
  }
  assert.deepEqual(await workspaceRequest(''), value)
  assert.equal(signedIn(), true)
})
test('membership revocation clears the session and notifies workspace listeners', async (t) => {
  setup(t)
  let reason
  const off = onSessionEnd((value) => {
    reason = value
  })
  t.after(off)
  globalThis.fetch = async () =>
    response(
      { error: 'Membership removed', code: 'workspace_membership_revoked' },
      403,
    )
  await assert.rejects(workspaceRequest(''), /membership was revoked/)
  assert.equal(signedIn(), false)
  assert.equal(reason, 'revoked')
})
test('a role-restricted action does not clear an otherwise valid session', async (t) => {
  setup(t)
  globalThis.fetch = async () =>
    response({ error: 'An approver is required' }, 403)
  await assert.rejects(workspaceRequest('/plan', 'PUT', {}), /approver/)
  assert.equal(signedIn(), true)
})

test('local sign-out cancels a deferred GET and prevents workspace restoration', async (t) => {
  setup(t)
  const pending = deferred(),
    scope = createRequestScope(),
    request = scope.capture(),
    session = captureSession()
  let workspace = { privateReason: 'initial workspace reason' },
    notice = '',
    busy = true,
    signal
  const unsubscribe = onSessionEnd(() => {
    scope.invalidate()
    workspace = null
    notice = 'Signed out on this browser.'
    busy = false
  })
  t.after(unsubscribe)
  globalThis.fetch = async (_url, options) => {
    signal = options.signal
    // Deliberately ignore cancellation to exercise the response guard too.
    return pending.promise
  }
  const completion = workspaceRequest('', 'GET', undefined, request.signal)
    .then((value) => {
      if (request.isCurrent() && session.isCurrent()) {
        workspace = value
        notice = 'Workspace refreshed.'
      }
    })
    .catch((cause) => {
      assert.equal(cause.name, 'AbortError')
    })
    .finally(() => {
      if (request.isCurrent() && session.isCurrent()) busy = false
    })

  signOut()
  assert.equal(signal.aborted, true)
  assert.equal(signedIn(), false)
  pending.resolve(response({ privateReason: 'late workspace reason' }))
  await completion
  assert.equal(workspace, null)
  assert.equal(notice, 'Signed out on this browser.')
  assert.equal(busy, false)
})

test('sign-out during deferred JSON parsing cannot return private workspace data', async (t) => {
  setup(t)
  const body = deferred(),
    started = deferred()
  globalThis.fetch = async () => ({
    ...response(null),
    json: () => {
      started.resolve()
      return body.promise
    },
  })
  const request = workspaceRequest(''),
    rejection = assert.rejects(request, { name: 'AbortError' })
  await started.promise
  signOut()
  body.resolve({
    audit: ['late private audit'],
    plan: { name: 'private plan' },
  })
  await rejection
})

test('401 invalidates other outstanding requests before parsing its body', async (t) => {
  setup(t)
  const pending = deferred()
  let firstSignal,
    ended = 0
  const unsubscribe = onSessionEnd((reason) => {
    assert.equal(reason, 'expired')
    ended += 1
  })
  t.after(unsubscribe)
  globalThis.fetch = async (_url, options) => {
    if (!firstSignal) {
      firstSignal = options.signal
      return pending.promise
    }
    return {
      ...response(null, 401),
      json: () => {
        throw new Error('401 body should not delay session invalidation')
      },
    }
  }
  const oldRequest = workspaceRequest(''),
    rejection = assert.rejects(oldRequest, { name: 'AbortError' })
  await assert.rejects(workspaceRequest(''), /Sign in again/)
  assert.equal(firstSignal.aborted, true)
  assert.equal(signedIn(), false)
  assert.equal(ended, 1)
  pending.resolve(response({ audit: ['late private audit'] }))
  await rejection
})

test('a late 401 from a signed-out session cannot sign out a newer session', async (t) => {
  const { signInLocally } = setup(t),
    pending = deferred()
  globalThis.fetch = async () => pending.promise
  const oldRequest = workspaceRequest(''),
    rejection = assert.rejects(oldRequest, { name: 'AbortError' })
  signOut()
  signInLocally('new-offline-test-session')
  const currentSession = captureSession()
  pending.resolve(response(null, 401))
  await rejection
  assert.equal(signedIn(), true)
  assert.equal(currentSession.isCurrent(), true)
})

test('unmount and newer operations invalidate earlier component completions', async () => {
  const scope = createRequestScope(),
    pending = deferred(),
    initial = scope.capture()
  let committed = false
  const completion = pending.promise.then(() => {
    if (initial.isCurrent()) committed = true
  })
  scope.invalidate()
  const newer = scope.capture()
  assert.equal(initial.signal.aborted, true)
  assert.equal(initial.isCurrent(), false)
  assert.equal(newer.isCurrent(), true)
  // Component cleanup invalidates the newer operation as well.
  scope.invalidate()
  assert.equal(newer.signal.aborted, true)
  assert.equal(newer.isCurrent(), false)
  pending.resolve()
  await completion
  assert.equal(committed, false)
})

test('component cancellation is propagated to workspace mutations', async (t) => {
  setup(t)
  const scope = createRequestScope(),
    operation = scope.capture(),
    pending = deferred()
  let signal
  globalThis.fetch = async (_url, options) => {
    signal = options.signal
    return pending.promise
  }
  const request = workspaceRequest(
      '/plan',
      'PUT',
      { plan: {} },
      operation.signal,
    ),
    rejection = assert.rejects(request, { name: 'AbortError' })
  scope.invalidate()
  assert.equal(signal.aborted, true)
  pending.resolve(response({ version: 2 }))
  await rejection
  assert.equal(signedIn(), true)
})
