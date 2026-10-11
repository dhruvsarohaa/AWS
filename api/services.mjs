import { gzipSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'
import { hash } from './core.mjs'

let secretsCache
export async function credentials() {
  if (!process.env.PROVIDER_SECRET_ARN)
    return Object.fromEntries(
      [
        'OPENAQ_API_KEY',
        'DATAGOV_API_KEY',
        'OPEN_METEO_API_KEY',
        'FIRMS_MAP_KEY',
        'ALERT_SIGNING_KEY',
      ].map((key) => [key, process.env[key] || '']),
    )
  if (secretsCache && Date.now() - secretsCache.at < 300000)
    return secretsCache.value
  const result = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: process.env.PROVIDER_SECRET_ARN }),
  )
  const value = JSON.parse(result.SecretString || '{}')
  secretsCache = { at: Date.now(), value }
  return value
}
let localQueue = null
export const setLocalQueue = (callback) => {
  localQueue = callback
}
export async function enqueue(job, notification = false) {
  const queue = notification
    ? process.env.NOTIFICATION_QUEUE_URL
    : process.env.REFRESH_QUEUE_URL
  if (queue)
    return new SQSClient({}).send(
      new SendMessageCommand({
        QueueUrl: queue,
        MessageBody: JSON.stringify(job),
      }),
    )
  if (!localQueue) throw new Error('Local job processor is not running')
  localQueue(job, notification)
}
export async function archive(kind, payload) {
  const date = new Date().toISOString().slice(0, 10),
    id = hash(payload),
    key = `${kind}/${date}/${Date.now()}-${id}.json.gz`,
    body = gzipSync(
      JSON.stringify({
        schemaVersion: 2,
        kind,
        archivedAt: new Date().toISOString(),
        ...payload,
      }),
    )
  if (process.env.ARCHIVE_BUCKET)
    await new S3Client({}).send(
      new PutObjectCommand({
        Bucket: process.env.ARCHIVE_BUCKET,
        Key: key,
        Body: body,
        ContentType: 'application/json',
        ContentEncoding: 'gzip',
        ServerSideEncryption: 'AES256',
      }),
    )
  else {
    const folder = resolve('.airday-local', 'archives', kind, date)
    await mkdir(folder, { recursive: true })
    await writeFile(resolve(folder, key.split('/').at(-1)), body, {
      mode: 0o600,
    })
  }
  return key
}
