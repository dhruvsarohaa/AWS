import { r4Capabilities } from './r4-integrations.mjs'
import { r5Capabilities } from './r5-devices.mjs'
import { integrationAdapters, deviceProfiles } from './pilot-config.mjs'

// An omitted or misspelled release scope must not activate paused integrations.
export const releaseScope = () =>
  process.env.RELEASE_SCOPE === 'Full' ? 'Full' : 'R0R2'
export function capabilities() {
  const full = releaseScope() === 'Full'
  const shared = full && process.env.SHARED_WORKSPACES_ENABLED === 'true'
  const disabled = (value) =>
    Object.fromEntries(Object.keys(value).map((key) => [key, false]))
  const r4 = r4Capabilities(integrationAdapters),
    r5 = r5Capabilities(deviceProfiles)
  return {
    sharedWorkspaces: shared,
    localGroups: full,
    reviewEmail:
      shared &&
      process.env.REVIEW_EMAIL_ENABLED === 'true' &&
      Boolean(process.env.NOTIFICATION_SENDER),
    publicEvidence:
      full &&
      process.env.PUBLIC_EVIDENCE_ENABLED === 'true' &&
      process.env.PUBLIC_REDISTRIBUTION_REVIEWED === 'true',
    weather: full && process.env.WEATHER_ENABLED === 'true',
    fires:
      full &&
      process.env.FIRES_ENABLED === 'true' &&
      process.env.FIRMS_PRODUCT_VERIFIED === 'true',
    r4: full ? r4 : disabled(r4),
    r5: full ? r5 : disabled(r5),
  }
}
