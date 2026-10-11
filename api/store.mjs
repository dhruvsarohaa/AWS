import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb'
const timeline = (pk, sk, data) =>
  pk.startsWith('DECISIONS#')
    ? { timelinePk: pk, timelineSk: `${data.at}#${sk}` }
    : {}

export class MemoryStore {
  constructor() {
    this.rows = new Map()
  }
  assertAvailable() {
    if (this.storageFailed)
      throw new Error('Local durable storage needs recovery before use.')
  }
  async get(pk, sk = 'current') {
    this.assertAvailable()
    return structuredClone(this.rows.get(`${pk}|${sk}`) || null)
  }
  async put(pk, sk, data, extra = {}) {
    this.assertAvailable()
    const row = { pk, sk, data: structuredClone(data), ...extra }
    this.rows.set(`${pk}|${sk}`, row)
    await this.flush()
    return row
  }
  async delete(pk, sk = 'current') {
    this.assertAvailable()
    this.rows.delete(`${pk}|${sk}`)
    await this.flush()
  }
  async list(pk, limit = 200) {
    this.assertAvailable()
    return [...this.rows.values()]
      .filter((row) => row.pk === pk)
      .sort((a, b) =>
        (b.timelineSk || b.sk).localeCompare(a.timelineSk || a.sk),
      )
      .slice(0, limit)
      .map((row) => structuredClone(row))
  }
  async range(pk, from, to, limit = 100, after = null) {
    this.assertAvailable()
    const rows = [...this.rows.values()]
      .filter(
        (r) =>
          r.pk === pk &&
          r.sk >= from &&
          r.sk <= to &&
          (!after || r.sk > after) &&
          (!r.expireAt || r.expireAt > Date.now() / 1000),
      )
      .sort((a, b) => a.sk.localeCompare(b.sk))
      .slice(0, limit + 1)
    return {
      rows: structuredClone(rows.slice(0, limit)),
      after: rows.length > limit ? rows[limit - 1].sk : null,
    }
  }
  async claim(pk, seconds, now = Date.now()) {
    this.assertAvailable()
    const key = `${pk}|lock`,
      row = this.rows.get(key)
    if (row && row.until > now) return false
    this.rows.set(key, {
      pk,
      sk: 'lock',
      until: now + seconds * 1000,
      expireAt: Math.ceil(now / 1000) + seconds + 86400,
    })
    await this.flush()
    return true
  }
  async increment(pk, limit, expires) {
    this.assertAvailable()
    const key = `${pk}|counter`,
      row = this.rows.get(key) || {
        pk,
        sk: 'counter',
        count: 0,
        expireAt: expires,
      }
    if (row.count >= limit) return false
    row.count++
    this.rows.set(key, row)
    await this.flush()
    return true
  }
  async replace(pk, sk, data, expected, extra = {}) {
    this.assertAvailable()
    const previous = this.rows.get(`${pk}|${sk}`)
    if (expected === 0 ? Boolean(previous) : previous?.version !== expected)
      return false
    this.rows.set(`${pk}|${sk}`, {
      pk,
      sk,
      data: structuredClone(data),
      ...timeline(pk, sk, data),
      version: expected + 1,
      ...extra,
    })
    await this.flush()
    return true
  }
  async flush() {}
  async transaction(writes) {
    this.assertAvailable()
    if (
      !writes.length ||
      writes.length > 25 ||
      writes.some(w => w.check && w.expected === undefined && w.expectedData === undefined) ||
      new Set(writes.map((w) => `${w.pk}|${w.sk}`)).size !== writes.length
    )
      throw new Error('Invalid transaction')
    for (const w of writes) {
      const previous = this.rows.get(`${w.pk}|${w.sk}`)
      if (
        w.expected !== undefined &&
        (w.expected === 0
          ? Boolean(previous)
          : previous?.version !== w.expected)
      )
        return false
      if (
        w.expectedData !== undefined &&
        !isDeepStrictEqual(previous?.data, w.expectedData)
      )
        return false
    }
    for (const w of writes) {
      if (w.check) continue
      if (w.delete) this.rows.delete(`${w.pk}|${w.sk}`)
      else
        this.rows.set(`${w.pk}|${w.sk}`, {
          pk: w.pk,
          sk: w.sk,
          data: structuredClone(w.data),
          ...timeline(w.pk, w.sk, w.data),
          ...(w.expected !== undefined ? { version: w.expected + 1 } : {}),
          ...w.extra,
        })
    }
    try {
      await this.flush()
    } catch (error) {
      // Fail closed: never keep writing an in-memory state whose durable outcome is uncertain.
      this.storageFailed = true
      throw error
    }
    return true
  }
  async replaceWithAudit(pk, sk, data, expected, auditPk, audit) {
    this.assertAvailable()
    const previous = this.rows.get(`${pk}|${sk}`)
    if (expected === 0 ? Boolean(previous) : previous?.version !== expected)
      return false
    this.rows.set(`${pk}|${sk}`, {
      pk,
      sk,
      data: structuredClone(data),
      ...timeline(pk, sk, data),
      version: expected + 1,
    })
    const auditSk = `${audit.at}#${crypto.randomUUID()}`
    this.rows.set(`${auditPk}|${auditSk}`, {
      pk: auditPk,
      sk: auditSk,
      data: structuredClone(audit),
    })
    await this.flush()
    return true
  }
}
export class FileStore extends MemoryStore {
  constructor(directory = resolve('.airday-local')) {
    super()
    this.directory = directory
    this.pending = Promise.resolve()
  }
  async get(...args) {
    await this.pending
    return super.get(...args)
  }
  async list(...args) {
    await this.pending
    return super.list(...args)
  }
  async range(...args) {
    await this.pending
    return super.range(...args)
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true })
    try {
      const rows = JSON.parse(
        await readFile(resolve(this.directory, 'state.json'), 'utf8'),
      )
      this.rows = new Map(rows.map((row) => [`${row.pk}|${row.sk}`, row]))
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error(
          'Local evidence storage is unreadable; restore it from a backup before continuing.',
        )
    }
    return this
  }
  async flush() {
    if (this.storageFailed)
      throw new Error(
        'Local durable storage needs recovery before more writes.',
      )
    for (const [key, row] of this.rows)
      if (row.expireAt && row.expireAt <= Date.now() / 1000)
        this.rows.delete(key)
    const content = JSON.stringify([...this.rows.values()])
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await writeFile(resolve(this.directory, 'state.tmp'), content, {
          mode: 0o600,
        })
        await rename(
          resolve(this.directory, 'state.tmp'),
          resolve(this.directory, 'state.json'),
        )
      })
    try {
      return await this.pending
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'local_evidence_write_failed',
          code: error.code || 'unknown',
        }),
      )
      this.storageFailed = true
      throw error
    }
  }
}
export class DynamoStore {
  constructor(table) {
    this.table = table
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    })
  }
  async get(pk, sk = 'current') {
    return (
      (
        await this.client.send(
          new GetCommand({
            TableName: this.table,
            Key: { pk, sk },
            ConsistentRead: true,
          }),
        )
      ).Item || null
    )
  }
  async put(pk, sk, data, extra = {}) {
    await this.client.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk, sk, data, ...extra },
      }),
    )
  }
  async transaction(writes) {
    if (
      !writes.length ||
      writes.length > 25 ||
      writes.some(w => w.check && w.expected === undefined && w.expectedData === undefined) ||
      new Set(writes.map((w) => `${w.pk}|${w.sk}`)).size !== writes.length
    )
      throw new Error('Invalid transaction')
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: writes.map((w) => {
            const expressions = [], names = {}, values = {}
            if (w.expected !== undefined) {
              if (w.expected === 0) expressions.push('attribute_not_exists(pk)')
              else {
                expressions.push('#version = :expected')
                names['#version'] = 'version'
                values[':expected'] = w.expected
              }
            }
            if (w.expectedData !== undefined) {
              expressions.push('#data = :expectedData')
              names['#data'] = 'data'
              values[':expectedData'] = w.expectedData
            }
            if (w.check && !expressions.length)
              throw new Error('A transaction check requires a condition')
            const condition = expressions.length ? {
              ConditionExpression: expressions.join(' AND '),
              ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
              ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
            } : {}
            if (w.check)
              return {
                ConditionCheck: {
                  TableName: this.table,
                  Key: { pk: w.pk, sk: w.sk },
                  ...condition,
                },
              }
            return w.delete
              ? {
                  Delete: {
                    TableName: this.table,
                    Key: { pk: w.pk, sk: w.sk },
                    ...condition,
                  },
                }
              : {
                  Put: {
                    TableName: this.table,
                    Item: {
                      pk: w.pk,
                      sk: w.sk,
                      data: w.data,
                      ...timeline(w.pk, w.sk, w.data),
                      ...(w.expected !== undefined
                        ? { version: w.expected + 1 }
                        : {}),
                      ...w.extra,
                    },
                    ...condition,
                  },
                }
          }),
        }),
      )
      return true
    } catch (error) {
      if (
        error.name === 'TransactionCanceledException' &&
        error.CancellationReasons?.some(
          (r) => r.Code === 'ConditionalCheckFailed',
        )
      )
        return false
      throw error
    }
  }
  async delete(pk, sk = 'current') {
    await this.client.send(
      new DeleteCommand({ TableName: this.table, Key: { pk, sk } }),
    )
  }
  async list(pk, limit = 200) {
    const rows = []
    let cursor
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.table,
          ...(pk.startsWith('DECISIONS#') ? { IndexName: 'Timeline' } : {}),
          KeyConditionExpression: pk.startsWith('DECISIONS#')
            ? 'timelinePk = :pk'
            : 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          Limit: Math.min(100, limit - rows.length),
          ExclusiveStartKey: cursor,
          ConsistentRead: !pk.startsWith('DECISIONS#'),
          ScanIndexForward: false,
        }),
      )
      rows.push(...(result.Items || []))
      cursor = result.LastEvaluatedKey
    } while (cursor && rows.length < limit)
    return rows
  }
  async range(pk, from, to, limit = 100, after = null) {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':pk': pk, ':from': from, ':to': to },
        Limit: limit,
        ConsistentRead: true,
        ScanIndexForward: true,
        ...(after ? { ExclusiveStartKey: { pk, sk: after } } : {}),
      }),
    )
    return {
      rows: (result.Items || []).filter(
        (r) => !r.expireAt || r.expireAt > Date.now() / 1000,
      ),
      after: result.LastEvaluatedKey?.sk || null,
    }
  }
  async claim(pk, seconds, now = Date.now()) {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            pk,
            sk: 'lock',
            until: now + seconds * 1000,
            expireAt: Math.ceil(now / 1000) + seconds + 86400,
          },
          ConditionExpression: 'attribute_not_exists(pk) OR #until <= :now',
          ExpressionAttributeNames: { '#until': 'until' },
          ExpressionAttributeValues: { ':now': now },
        }),
      )
      return true
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return false
      throw error
    }
  }
  async increment(pk, limit, expires) {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk, sk: 'counter' },
          UpdateExpression:
            'SET #count = if_not_exists(#count, :zero) + :one, expireAt = :expires',
          ConditionExpression:
            'attribute_not_exists(#count) OR #count < :limit',
          ExpressionAttributeNames: { '#count': 'count' },
          ExpressionAttributeValues: {
            ':zero': 0,
            ':one': 1,
            ':expires': expires,
            ':limit': limit,
          },
        }),
      )
      return true
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return false
      throw error
    }
  }
  async replace(pk, sk, data, expected, extra = {}) {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            pk,
            sk,
            data,
            ...timeline(pk, sk, data),
            version: expected + 1,
            ...extra,
          },
          ConditionExpression:
            expected === 0
              ? 'attribute_not_exists(pk)'
              : '#version = :expected',
          ...(expected
            ? {
                ExpressionAttributeNames: { '#version': 'version' },
                ExpressionAttributeValues: { ':expected': expected },
              }
            : {}),
        }),
      )
      return true
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return false
      throw error
    }
  }
  async replaceWithAudit(pk, sk, data, expected, auditPk, audit) {
    try {
      await this.client.send(
        new TransactWriteCommand({
          ClientRequestToken: crypto.randomUUID(),
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: {
                  pk,
                  sk,
                  data,
                  ...timeline(pk, sk, data),
                  version: expected + 1,
                },
                ConditionExpression:
                  expected === 0
                    ? 'attribute_not_exists(pk)'
                    : '#version = :expected',
                ...(expected
                  ? {
                      ExpressionAttributeNames: { '#version': 'version' },
                      ExpressionAttributeValues: { ':expected': expected },
                    }
                  : {}),
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: {
                  pk: auditPk,
                  sk: `${audit.at}#${crypto.randomUUID()}`,
                  data: audit,
                },
              },
            },
          ],
        }),
      )
      return true
    } catch (error) {
      if (
        error.name === 'TransactionCanceledException' &&
        error.CancellationReasons?.some(
          (reason) => reason.Code === 'ConditionalCheckFailed',
        )
      )
        return false
      throw error
    }
  }
}
let instance
export async function getStore() {
  if (!instance)
    instance = process.env.EVIDENCE_TABLE
      ? new DynamoStore(process.env.EVIDENCE_TABLE)
      : await new FileStore().initialize()
  return instance
}
