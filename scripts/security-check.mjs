import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
const ignored = new Set([
    'node_modules',
    'dist',
    '.git',
    '.aws-sam',
    '.airday-build',
    '.airday-local',
  ]),
  findings = []
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:OPENAQ_API_KEY|DATAGOV_API_KEY|OPEN_METEO_API_KEY|FIRMS_MAP_KEY|ALERT_SIGNING_KEY)\s*=\s*[^\s#'"\r\n][^\r\n]{8,}/,
]
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (
      ignored.has(entry.name) ||
      (entry.name.startsWith('.env') && entry.name !== '.env.example') ||
      entry.name.startsWith('.airday-') ||
      entry.name === 'pnpm-lock.yaml'
    )
      continue
    const path = join(folder, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (/\.(?:mjs|ts|tsx|json|md|yaml|yml|ps1|example)$/.test(path)) {
      const lines = (await readFile(path, 'utf8')).split(/\r?\n/)
      lines.forEach((line, index) => {
        if (patterns.some((pattern) => pattern.test(line)))
          findings.push({ file: path, line: index + 1 })
      })
    }
  }
}
await walk('.')
if (findings.length) {
  console.error(JSON.stringify({ potentialSecrets: findings }, null, 2))
  process.exitCode = 1
} else
  console.log(
    'Source scan found no matching credential literals. This pattern scan does not certify absence of vulnerabilities.',
  )
