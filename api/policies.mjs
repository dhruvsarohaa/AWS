import { readFile } from 'node:fs/promises'
import { hash, timestamp } from './core.mjs'

export async function policyFor(place, date, records) {
  const registry =
    records ||
    JSON.parse(
      await readFile(
        new URL('./config/policies.json', import.meta.url),
        'utf8',
      ),
    )
  const relevant = registry.records.filter(
    (record) =>
      record.status === 'reviewed' &&
      ['order', 'advisory'].includes(record.kind) &&
      timestamp(record.reviewedAt) &&
      Date.parse(record.reviewedAt) <= Date.now() + 300000 &&
      record.reviewedBy &&
      record.documentHash &&
      /^https:\/\//.test(record.url) &&
      record.jurisdictions?.some((name) =>
        [place.state, place.name].some(
          (value) => value.toLowerCase() === name.toLowerCase(),
        ),
      ) &&
      record.effectiveFrom <= date &&
      (!record.effectiveTo || date <= record.effectiveTo) &&
      !record.revokedAt,
  )
  const stale = relevant.some(
    (record) => Date.now() - Date.parse(record.reviewedAt) > 24 * 3600000,
  )
  return {
    version: hash(relevant),
    date,
    status:
      !relevant.length || stale ? 'verification_needed' : 'reviewed_guidance',
    records: relevant,
    sources: registry.sources,
    message: !relevant.length
      ? 'No current, applicable order has been verified in this deployment. Check the issuing authority before planning.'
      : stale
        ? 'The stored guidance needs a new check for amendments or revocation.'
        : 'Reviewed guidance is available. Confirm its scope and activity requirements.',
  }
}
