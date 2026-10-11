import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { FileStore, DynamoStore } from '../api/store.mjs'
import { nearbyStations } from '../api/spatial.mjs'
import { timestamp, unit, validDate } from '../api/core.mjs'
import { stationCapacity } from '../api/spatial.mjs'
import { eraseWorkspaceEmail } from '../api/email-retention.mjs'
import { subPk, revokeSubscription } from '../api/subscriptions.mjs'

const args = process.argv.slice(2).filter((value) => value !== '--'),
  command = args[0],
  option = (name) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : undefined
if (!command || command === 'help') {
  console.log(
    'Commands: status, pause, resume, coverage, backup, restore, validate-config, member, revoke, erase-workspace, export-history. Add --local for local operations; cloud operations read .airday-deploy.json. See OPERATIONS.md.',
  )
  process.exit(0)
}
if (command === 'validate-config') {
  stationCapacity()
  const contract = JSON.parse(
      await readFile('api/config/cpcb-contract.json', 'utf8'),
    ),
    registry = JSON.parse(await readFile('api/config/policies.json', 'utf8')),
    mapping = JSON.parse(
      await readFile('api/config/station-mappings.json', 'utf8'),
    )
  if (
    contract.verified &&
    (contract.quantity !== 'concentration' ||
      !unit(contract.unit) ||
      contract.statistic !== 'mean' ||
      !(contract.periodSeconds > 0) ||
      !['measurement_end', 'provider_update'].includes(
        contract.timestampMeaning,
      ) ||
      !contract.reviewedBy ||
      !timestamp(contract.reviewedAt) ||
      !/^https:\/\//.test(contract.sourceDocument || ''))
  )
    throw new Error(
      'CPCB contract needs documented units, statistic, period, timestamp meaning and review.',
    )
  for (const record of registry.records)
    if (
      !record.id ||
      !record.title ||
      !['order', 'advisory'].includes(record.kind) ||
      !['reviewed', 'unverified'].includes(record.status) ||
      !validDate(record.effectiveFrom) ||
      (record.effectiveTo && !validDate(record.effectiveTo)) ||
      !Array.isArray(record.jurisdictions) ||
      !record.jurisdictions.length ||
      (record.status === 'reviewed' &&
        (!record.reviewedBy ||
          !timestamp(record.reviewedAt) ||
          !/^[a-f0-9]{64}$/.test(record.documentHash || '') ||
          !/^https:\/\//.test(record.url || '')))
    )
      throw new Error(
        'Policy registry contains incomplete scope, date, source or review metadata.',
      )
  for (const row of mapping.records)
    if (
      !['OpenAQ', 'CPCB / data.gov.in'].includes(row.source) ||
      !row.providerStationId ||
      !row.canonicalStationId ||
      !row.reviewedBy ||
      !timestamp(row.reviewedAt) ||
      !row.evidenceUrl?.startsWith('https://')
    )
      throw new Error(
        'Station mapping needs a verified identity and review evidence.',
      )
  console.log(
    'Configuration schemas passed. Schema validation does not verify the factual content of a policy or provider contract.',
  )
  process.exit(0)
}
let deployment
if (!args.includes('--local')) {
  deployment = JSON.parse(
    (await readFile('.airday-deploy.json', 'utf8')).replace(/^\uFEFF/, ''),
  )
  process.env.AWS_PROFILE = deployment.profile
  process.env.AWS_REGION = deployment.region
}
if (
  !deployment &&
  ['pause', 'resume', 'restore', 'erase-workspace'].includes(command)
) {
  let pid
  try {
    pid = Number(await readFile('.airday-local/api.pid', 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (pid) {
    let alive = true
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error.code === 'ESRCH') alive = false
    }
    if (alive)
      throw new Error(
        'Stop pnpm dev before modifying file-backed evidence; restart it after the operation.',
      )
  }
}
let store
if (deployment) store = new DynamoStore(deployment.outputs.EvidenceTableName)
else {
  store = new FileStore()
  try {
    await store.initialize()
  } catch (error) {
    if (command !== 'restore') throw error
    console.warn(
      'Local state is unreadable; preserve it and restore a verified snapshot.',
    )
  }
}
if (command === 'status') {
  console.log(
    JSON.stringify(
      {
        storage: deployment ? 'dynamodb' : 'local',
        control: (await store.get('CONTROL'))?.data || { paused: false },
        activeAreas: (await store.list('DEMAND', 100)).filter(
          (row) => row.expireAt > Date.now() / 1000,
        ).length,
        activeStations: (await store.list('STATIONS', 100)).filter(
          (row) => row.expireAt > Date.now() / 1000,
        ).length,
        archive: (await store.get('ARCHIVE_STATUS', 'forecast'))?.data,
      },
      null,
      2,
    ),
  )
} else if (['pause', 'resume'].includes(command)) {
  await store.put('CONTROL', 'current', {
    paused: command === 'pause',
    at: new Date().toISOString(),
  })
  console.log(
    `Ingestion ${command === 'pause' ? 'paused' : 'resumed'}. Cached reads remain available.`,
  )
} else if (command === 'coverage') {
  const areas = (await store.list('DEMAND', 100)).filter(
      (row) => row.expireAt > Date.now() / 1000,
    ),
    output = []
  for (const row of areas)
    output.push({
      area: row.data.id,
      stations: (await nearbyStations(store, row.data)).map((monitor) => ({
        station: monitor.station,
        source: monitor.source,
        distanceKm: monitor.distanceKm,
        observedAt: monitor.observedAt,
        stale: monitor.stale,
      })),
      sources: (await store.list(`SOURCE#${row.data.id}`, 3)).map(
        ({ sk, data }) => ({
          provider: sk,
          status: data.status,
          lastAttemptAt: data.lastAttemptAt,
        }),
      ),
    })
  console.log(
    JSON.stringify(
      {
        scope:
          'Active pilot areas; partial catalog, not a nationwide coverage census',
        areas: output,
      },
      null,
      2,
    ),
  )
} else if (command === 'backup') {
  if (deployment) {
    const { DynamoDBClient, CreateBackupCommand } =
      await import('@aws-sdk/client-dynamodb')
    const result = await new DynamoDBClient({}).send(
      new CreateBackupCommand({
        TableName: deployment.outputs.EvidenceTableName,
        BackupName: `airday-${Date.now()}`,
      }),
    )
    console.log(
      `Backup requested: ${result.BackupDetails.BackupArn}. Check availability before restoring.`,
    )
  } else {
    await mkdir('.airday-local/backups', { recursive: true })
    const path = resolve('.airday-local/backups', `${Date.now()}.backup.json`)
    await writeFile(path, JSON.stringify([...store.rows.values()]), {
      mode: 0o600,
    })
    console.log(`Local snapshot: ${path}`)
  }
} else if (command === 'restore') {
  if (deployment || !args.includes('--file') || !args.includes('--confirm'))
    throw new Error(
      'Local restore requires --local --file <backup> --confirm. Cloud restore creates a new table; use the documented AWS procedure.',
    )
  const rows = JSON.parse(await readFile(resolve(option('--file')), 'utf8'))
  if (
    !Array.isArray(rows) ||
    rows.some((row) => typeof row.pk !== 'string' || typeof row.sk !== 'string')
  )
    throw new Error('Invalid backup.')
  await mkdir('.airday-local/backups', { recursive: true })
  await writeFile(
    resolve(
      '.airday-local/backups',
      `${Date.now()}-before-restore.backup.json`,
    ),
    await readFile('.airday-local/state.json', 'utf8').catch(() =>
      JSON.stringify([...store.rows.values()]),
    ),
    { mode: 0o600 },
  )
  store.rows = new Map(rows.map((row) => [`${row.pk}|${row.sk}`, row]))
  await store.flush()
  console.log(
    'Local evidence restored. Restart the API; verify data before resuming ingestion.',
  )
} else if (command === 'erase-workspace') {
  const workspace = option('--workspace')
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/.test(workspace || '') ||
    !args.includes('--confirm')
  )
    throw new Error(
      'Erasure requires --workspace <ID> --confirm. Backups retain prior data until their documented expiry.',
    )
  let erased = 0
  const memberIds = []
  for (const row of await store.list('MEMBERS', 10000))
    if (row.data.workspaceId === workspace) {
      memberIds.push(row.sk)
      await store.delete('MEMBERS', row.sk)
      await store.delete(`PREFERENCES#${row.sk}`)
      erased++
    }
  erased += await eraseWorkspaceEmail(workspace, store, memberIds)
  for (const partition of [
    `DECISIONS#${workspace}`,
    `AUDIT#${workspace}`,
    `WORKSPACE#${workspace}`,
  ])
    for (;;) {
      const rows = await store.list(partition, 100)
      if (!rows.length) break
      for (const row of rows) {
        await store.delete(row.pk, row.sk)
        erased++
      }
    }
  console.log(
    `Erased ${erased} active workspace rows. Cognito identities and retained backups use separate deletion/retention procedures.`,
  )
} else if (command === 'export-history') {
  if (!args.includes('--sensor') || !/^\d+$/.test(option('--sensor')))
    throw new Error('Choose --sensor <OpenAQ sensor ID>.')
  const rows = await store.list(`HISTORY#${option('--sensor')}`, 10000)
  await mkdir('.airday-local/archives/observation', { recursive: true })
  const path = resolve(
    '.airday-local/archives/observation',
    `sensor-${option('--sensor')}.json`,
  )
  await writeFile(
    path,
    JSON.stringify({
      kind: 'observation',
      records: rows.map((row) => row.data),
      scope:
        'Bounded history export; source licensing must be reviewed before redistribution',
    }),
    { mode: 0o600 },
  )
  console.log(path)
} else if (['member', 'revoke'].includes(command)) {
  if (!deployment || !args.includes('--email'))
    throw new Error('Membership requires a deployed stack and --email.')
  const email = option('--email')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Invalid email.')
  const {
    CognitoIdentityProviderClient,
    AdminGetUserCommand,
    AdminCreateUserCommand,
    AdminUserGlobalSignOutCommand,
  } = await import('@aws-sdk/client-cognito-identity-provider')
  const client = new CognitoIdentityProviderClient({}),
    pool = deployment.outputs.UserPoolId
  let user
  try {
    user = await client.send(
      new AdminGetUserCommand({ UserPoolId: pool, Username: email }),
    )
  } catch (error) {
    if (error.name !== 'UserNotFoundException' || command === 'revoke')
      throw error
    if (!args.includes('--password-file'))
      throw new Error(
        'New users need --password-file with a temporary password. No invitation email is sent by this tool.',
      )
    const password = (
      await readFile(resolve(option('--password-file')), 'utf8')
    ).trim()
    if (password.length < 12)
      throw new Error(
        'Use a temporary password of at least 12 characters with upper/lowercase, number and symbol.',
      )
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: pool,
        Username: email,
        MessageAction: 'SUPPRESS',
        TemporaryPassword: password,
        UserAttributes: [{ Name: 'email', Value: email }],
      }),
    )
    user = await client.send(
      new AdminGetUserCommand({ UserPoolId: pool, Username: email }),
    )
  }
  const attrs = Object.fromEntries(
      user.UserAttributes.map((item) => [item.Name, item.Value]),
    ),
    sub = attrs.sub
  if (command === 'revoke') {
    await store.delete('MEMBERS', sub)
    const subscription = await store.get(subPk(sub))
    if (
      subscription?.data.enabled &&
      !(await revokeSubscription(subscription, store))
    )
      throw new Error(
        'Subscription changed during revocation. Retry to complete email cleanup.',
      )
    await client.send(
      new AdminUserGlobalSignOutCommand({ UserPoolId: pool, Username: email }),
    )
    console.log('Membership revoked and sessions signed out.')
  } else {
    const workspace = option('--workspace'),
      role = option('--role')
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(workspace || '') ||
      !['owner', 'approver', 'reviewer'].includes(role)
    )
      throw new Error(
        'Choose --workspace <ID> and --role owner|approver|reviewer.',
      )
    const previous = (await store.get('MEMBERS', sub))?.data
    await store.put('MEMBERS', sub, {
      workspaceId: workspace,
      role,
      email,
      emailVerified: attrs.email_verified === 'true',
      notifications: previous?.notifications || false,
    })
    console.log(
      `Membership configured: ${workspace}, ${role}. Email delivery requires verified email and explicit opt-in.`,
    )
  }
} else throw new Error('Unknown operator command. Use help.')
