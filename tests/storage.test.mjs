import assert from 'node:assert/strict'
import test from 'node:test'
import { removeStored, writeStored } from '../src/lib/storage.ts'

test('successful persistence stores JSON and reports success', () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  assert.equal(writeStored('airday-plan', { configured: true }, storage), true)
  assert.deepEqual(JSON.parse(values.get('airday-plan')), { configured: true })
  assert.equal(removeStored('airday-plan', storage), true)
  assert.equal(values.has('airday-plan'), false)
})
test('failed writes report session-only persistence, with a working later retry', () => {
  let blocked = true
  const storage = {
    getItem: () => null,
    setItem: () => {
      if (blocked) throw new Error('Quota exceeded')
    },
    removeItem: () => {},
  }
  assert.equal(writeStored('airday-plan', { configured: true }, storage), false)
  blocked = false
  assert.equal(writeStored('airday-plan', { configured: true }, storage), true)
})
test('failed removal never reports that a saved location was forgotten', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {
      throw new Error('Access denied')
    },
  }
  assert.equal(removeStored('airday-place', storage), false)
})
