import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stationCapacity } from '../api/spatial.mjs'
try {
  process.loadEnvFile('.env')
} catch (e) {
  if (e.code !== 'ENOENT') throw e
}
for (const key of [
  'OPENAQ_API_KEY',
  'DATAGOV_API_KEY',
  'OPEN_METEO_API_KEY',
  'FIRMS_MAP_KEY',
  'ALERT_SIGNING_KEY',
])
  console.log(
    `${key}: ${process.env[key] ? 'present on server (value hidden)' : 'not configured'}`,
  )
console.log(`Bounded active-station capacity: ${stationCapacity()}`)
console.log(
  `CPCB metadata: ${JSON.parse(readFileSync('api/config/cpcb-contract.json', 'utf8')).verified ? 'reviewed contract configured' : 'unverified; concentrations disabled'}`,
)
for (const path of ['.airday-build/api/handler.mjs', 'dist/index.html'])
  console.log(
    `${path}: ${existsSync(resolve(path)) ? 'built' : 'build required'}`,
  )
console.log(
  'Cloud release requires a signed-in AWS CLI profile, followed by scripts/deploy-aws.ps1. No credentials are requested or printed by this check.',
)
