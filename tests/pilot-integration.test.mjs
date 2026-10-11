import test from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStore, DynamoStore } from '../api/store.mjs'
import { capabilities } from '../api/capabilities.mjs'
import { handler } from '../api/handler.mjs'

test('membership change or removal atomically prevents dependent device writes', async () => {
  const store = new MemoryStore()
  const grant = { workspaceId: 'pilot-a', role: 'owner', emailVerified: true }
  await store.put('MEMBERS', 'owner', grant)
  const write = () =>
    store.transaction([
      { pk: 'MEMBERS', sk: 'owner', check: true, expectedData: grant },
      { pk: 'DEVICE', sk: 'current', expected: 0, data: { action: 'on' } },
    ])
  await store.put('MEMBERS', 'owner', { ...grant, role: 'reviewer' })
  assert.equal(await write(), false)
  assert.equal(await store.get('DEVICE'), null)
  await store.delete('MEMBERS', 'owner')
  assert.equal(await write(), false)
  assert.equal(await store.get('DEVICE'), null)
})

test('membership equality ignores object key order and preserves version checks', async () => {
  const store = new MemoryStore()
  await store.replace(
    'MEMBERS',
    'owner',
    { role: 'owner', workspaceId: 'a' },
    0,
  )
  const writes = (expected) => [
    {
      pk: 'MEMBERS',
      sk: 'owner',
      check: true,
      expected,
      expectedData: { workspaceId: 'a', role: 'owner' },
    },
    { pk: 'DEVICE', sk: 'current', expected: 0, data: { action: 'on' } },
  ]
  assert.equal(await store.transaction(writes(2)), false)
  assert.equal(await store.get('DEVICE'), null)
  assert.equal(await store.transaction(writes(1)), true)
  assert.equal((await store.get('MEMBERS', 'owner')).version, 1)
})

test('Dynamo membership data and version checks share one transaction', async () => {
  const store = new DynamoStore('synthetic-table')
  let input
  store.client.send = async (command) => {
    input = command.input
  }
  const grant = { workspaceId: 'a', role: 'owner' }
  assert.equal(
    await store.transaction([
      {
        pk: 'MEMBERS',
        sk: 'owner',
        check: true,
        expected: 2,
        expectedData: grant,
      },
      { pk: 'DEVICE', sk: 'current', expected: 0, data: { action: 'on' } },
    ]),
    true,
  )
  const check = input.TransactItems[0].ConditionCheck
  assert.equal(
    check.ConditionExpression,
    '#version = :expected AND #data = :expectedData',
  )
  assert.deepEqual(check.ExpressionAttributeNames, {
    '#version': 'version',
    '#data': 'data',
  })
  assert.deepEqual(check.ExpressionAttributeValues[':expectedData'], grant)
  store.client.send = async () => {
    throw {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    }
  }
  assert.equal(
    await store.transaction([
      { pk: 'MEMBERS', sk: 'owner', check: true, expectedData: grant },
    ]),
    false,
  )
  for (const target of [store, new MemoryStore()])
    await assert.rejects(
      () => target.transaction([{ pk: 'MEMBERS', sk: 'owner', check: true }]),
      /Invalid transaction/,
    )
})

test('public configuration exposes closed provider and hardware gates without secrets', async () => {
  const config = capabilities()
  assert.deepEqual(config.r4, {
    localJourneys: false,
    explanationAssistant: false,
    routeComparison: false,
    wearableSync: false,
    indianPollen: false,
    denseAirMap: false,
  })
  assert.deepEqual(config.r5, {
    indoorDevices: false,
    deviceControls: false,
    deviceAutomation: false,
    siteControls: false,
  })
  const result = await handler({
    rawPath: '/api/config',
    requestContext: { http: { method: 'GET' } },
  })
  assert.equal(result.statusCode, 200)
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.deepEqual(JSON.parse(result.body).capabilities.r5, config.r5)
  assert.doesNotMatch(
    result.body,
    /gatewayId|deviceIds|accessToken|credentialVersion/,
  )
})
