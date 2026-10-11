// Isolated, synthetic browser QA only. Never imported by production builds.
// Run after pnpm build: node tests/browser-review-server.mjs
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { MemoryStore } from '../api/store.mjs'
import { createEngine } from '../api/engine.mjs'
import { validateForecast, placeFromParams } from '../api/core.mjs'
import { validateWeather, WEATHER_FIELDS } from '../api/providers/weather.mjs'
import { validateFires } from '../api/providers/fires.mjs'
import {
  publicProjection,
  widgetResponse,
  planningDate,
  publicArea,
} from '../api/public-evidence.mjs'
import { workspaceRoute } from '../api/workspaces.mjs'
import {
  subscriptionsRoute,
  unsubscribe,
  signUnsubscribe,
} from '../api/subscriptions.mjs'
import { setLocalQueue } from '../api/services.mjs'
import { planVersion } from '../src/lib/planner.ts'
import { validDecisionRecords } from '../src/lib/storage.ts'
import { reviewedLocation, assessWindow } from '../src/lib/decision-evidence.ts'
import { sharedPlan } from './fixtures.mjs'

const secret = 'synthetic-browser-review-signing-material-only-0123456789'
// These affect this test process only; no .env or AWS credentials are loaded.
process.env.INGESTION_ENABLED = 'false'
process.env.REVIEW_EMAIL_ENABLED = 'true'
process.env.NOTIFICATION_SENDER = 'synthetic@example.test'
process.env.ALERT_SIGNING_KEY = secret
for (const key of [
  'PROVIDER_SECRET_ARN',
  'NOTIFICATION_QUEUE_URL',
  'REFRESH_QUEUE_URL',
  'ARCHIVE_BUCKET',
  'EVIDENCE_TABLE',
])
  delete process.env[key]
setLocalQueue(async () => {}) // No worker, SES, provider, archive or cloud calls.
const store = new MemoryStore(),
  now = Date.now(),
  fetchedAt = new Date(now).toISOString()
const member = {
  sub: 'synthetic-owner',
  workspaceId: 'synthetic-browser-qa',
  role: 'owner',
  email: 'synthetic@example.test',
  emailVerified: true,
  notifications: false,
}
const place = {
  name: 'SYNTHETIC Delhi',
  state: 'Delhi',
  country: 'India',
  latitude: 28.6,
  longitude: 77.2,
  detected: false,
  confirmed: true,
}
const date = planningDate(),
  plan = {
    ...sharedPlan,
    name: 'SYNTHETIC browser QA plan',
    activities: [1, 2, 3].map((n) => ({
      ...sharedPlan.activities[0],
      id: `walk-${n}`,
      activity: `SYNTHETIC walk ${n}`,
      days: [0, 1, 2, 3, 4, 5, 6],
    })),
  }
const times = Array.from({ length: 72 }, (_, i) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + i * 3600000)
    .toISOString()
    .slice(0, 16),
)
const forecast = validateForecast(
  {
    timezone: 'Asia/Kolkata',
    utc_offset_seconds: 19800,
    latitude: 28.6,
    longitude: 77.2,
    hourly_units: { pm2_5: 'μg/m³', pm10: 'μg/m³' },
    hourly: {
      time: times,
      pm2_5: times.map((t) => (t.endsWith('08:00') ? 100 : 30)),
      pm10: times.map(() => 55),
    },
  },
  now,
)
const engine = createEngine({
  store,
  request: () => {
    throw new Error('Browser fixtures cannot contact providers')
  },
  keys: async () => ({}),
  enqueue: async () => {},
  archive: async () => {},
})
await store.put('MEMBERS', member.sub, member)
await store.put('SOURCE#28.6,77.2', 'forecast', {
  value: { forecast },
  status: { status: 'live', message: 'SYNTHETIC BROWSER FIXTURE' },
  lastAttemptAt: fetchedAt,
  lastSuccessAt: fetchedAt,
})
await store.replace(`FORECAST#${forecast.id}`, 'current', forecast, 0)
await workspaceRoute(
  'PUT',
  '/api/workspace/plan',
  { plan, version: 0 },
  member,
  store,
)
const dashboard = await engine.dashboard(place, date)
const records = [1, 2, 3].map((n) => ({
  id: `browser-record-${n}`,
  activityId: `walk-${n}`,
  activity: `SYNTHETIC walk ${n}`,
  date,
  snapshotId: dashboard.snapshotId,
  at: new Date(now + n).toISOString(),
  choice: 'rescheduled',
  proposedStart: '10:00',
  proposedEnd: '11:00',
  reason: `SYNTHETIC browser reviewed record ${n}`,
  planVersion: planVersion(plan),
  threshold: 75,
  followThrough: 'unconfirmed',
  lifecycle: 'recorded',
  location: reviewedLocation(place),
  originalWindow: { start: '08:00', end: '09:00' },
  chosenWindow: { start: '10:00', end: '11:00' },
  originalAssessment: assessWindow(
    plan.activities[n - 1],
    forecast.points,
    date,
    75,
    now,
    forecast.fetchedAt,
  ),
  chosenAssessment: assessWindow(
    { ...plan.activities[n - 1], start: '10:00', end: '11:00' },
    forecast.points,
    date,
    75,
    now,
    forecast.fetchedAt,
  ),
  policyStatus: dashboard.policy.status,
  policyVersion: dashboard.policy.version,
}))
if (!validDecisionRecords(records))
  throw new Error('Browser journal fixtures failed validation')
const utcDay = new Date(now).toISOString().slice(0, 10)
const weatherTimes = Array.from({ length: 72 }, (_, i) =>
  new Date(Date.parse(`${utcDay}T00:00:00Z`) + i * 3600000)
    .toISOString()
    .slice(0, 16),
)
const weather = validateWeather(
  {
    timezone: 'UTC',
    utc_offset_seconds: 0,
    latitude: 28.6,
    longitude: 77.2,
    hourly_units: Object.fromEntries(
      Object.entries(WEATHER_FIELDS).map(([k, v]) => [k, v[1]]),
    ),
    hourly: {
      time: weatherTimes,
      temperature_2m: weatherTimes.map(() => 29),
      apparent_temperature: weatherTimes.map((_, i) => (i % 4 === 0 ? 27 : 31)),
      relative_humidity_2m: weatherTimes.map(() => 60),
      precipitation: weatherTimes.map((_, i) => (i % 3 === 0 ? 0 : null)),
      wind_speed_10m: weatherTimes.map(() => 3),
      wind_direction_10m: weatherTimes.map(() => 120),
    },
  },
  now,
)
weather.source = 'SYNTHETIC Open-Meteo weather fixture'
const acquisition = new Date(now - 3600000).toISOString(),
  header =
    'latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp'
const fires = validateFires(
  `${header}\n28.8,77.3,${acquisition.slice(0, 10)},${acquisition.slice(11, 16).replace(':', '')},N20,VIIRS,h,12\n28.5,77.1,${acquisition.slice(0, 10)},${acquisition.slice(11, 16).replace(':', '')},N20,VIIRS,n,0\n`,
  { latitude: 28.6, longitude: 77.2 },
  now,
  'VIIRS_NOAA20_NRT',
)
fires.meaning = `SYNTHETIC BROWSER FIXTURES. ${fires.meaning}`
const modes = [
  'normal',
  'stale-weather',
  'context-error',
  'public-error',
  'empty-fires',
  'save-refresh-error',
  'revoked',
]
let mode = 'normal',
  failNextWorkspaceRead = false
const banner =
  '<aside style="padding:12px;background:#fff0c2;color:#3b2800;font:16px system-ui;border:2px solid #705000">SYNTHETIC BROWSER QA · localhost only · no real account, email or provider data. <a href="/qa">Fixture controls</a></aside>'
const root = resolve('dist')
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}
async function body(request) {
  const chunks = []
  let size = 0
  for await (const c of request) {
    size += c.length
    if (size > 64000) throw new Error('Fixture request too large')
    chunks.push(c)
  }
  const value = Buffer.concat(chunks).toString()
  return value ? JSON.parse(value) : {}
}
const server = createServer(async (request, reply) => {
  const url = new URL(request.url, 'http://127.0.0.1:5175'),
    path = url.pathname
  const json = (value, status = 200) => {
    reply.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-airday-fixture': 'synthetic-browser-qa',
    })
    reply.end(JSON.stringify(value))
  }
  try {
    if (path === '/qa-mode' && request.method === 'POST') {
      const chunks = []
      for await (const c of request) chunks.push(c)
      const next = new URLSearchParams(Buffer.concat(chunks).toString()).get(
        'mode',
      )
      if (!modes.includes(next))
        return json({ error: 'Unknown fixture mode' }, 400)
      mode = next
      reply.writeHead(303, { location: '/qa' })
      return reply.end()
    }
    if (path === '/qa') {
      const sub = (await store.get(`SUBSCRIPTION#${member.sub}`))?.data
      const link = sub?.enabled
        ? `<p><a href="/?email-action=unsubscribe#token=${signUnsubscribe(sub, secret)}">Open synthetic unsubscribe confirmation</a></p>`
        : ''
      reply.writeHead(200, {
        'content-type': 'text/html',
        'cache-control': 'no-store',
      })
      const localState = {
        plan,
        journal: records,
        oneOffs: [],
        dismissedAlerts: [],
        language: 'en',
        favorites: [],
        feedback: [],
        groups: [],
      }
      const startScript = `document.getElementById('start').onclick=()=>{sessionStorage.setItem('airday-session',JSON.stringify({accessToken:'synthetic-browser-token',until:Date.now()+3600000}));localStorage.setItem('airday-place',JSON.stringify(${JSON.stringify(place)}));const open=indexedDB.open('airday-planning',1);open.onupgradeneeded=()=>open.result.createObjectStore('documents');open.onsuccess=()=>{const db=open.result,t=db.transaction('documents','readwrite');t.objectStore('documents').put({schemaVersion:2,revision:0,state:${JSON.stringify(localState)}},'planning');t.oncomplete=()=>{db.close();location.href='/?date=${date}#settings'};t.onerror=()=>{db.close();alert('Synthetic fixture initialization failed')}}}`
      return reply.end(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic R3 browser controls</title>${banner}<h1>Fixture controls</h1><p>Mode: ${mode}. In-memory subscription: ${sub?.enabled ? 'enabled' : 'disabled'}.</p><button id="start">Start synthetic owner session and local plan</button><p><a href="/?date=${date}#settings">Open app settings</a> · <a href="/?display=1&area=28.6%2C77.2">Open public display</a> · <a href="/api/public/widget?area=28.6,77.2">Open static widget</a></p>${link}<form action="/qa-mode" method="post"><label>Fixture mode <select name="mode">${modes.map((m) => `<option${m === mode ? ' selected' : ''}>${m}</option>`).join('')}</select></label><button>Set fixture mode</button></form><script>${startScript}</script></html>`,
      )
    }
    if (path === '/api/health')
      return json({
        ok: true,
        version: 2,
        fixtures: true,
        storage: 'synthetic-memory',
      })
    if (path === '/api/config')
      return json({
        schemaVersion: 2,
        releaseScope: 'Full',
        clientId: 'synthetic-browser-only',
        authDomain: null,
        notificationConfigured: true,
        capabilities: {
          sharedWorkspaces: true,
          localGroups: true,
          reviewEmail: true,
          publicEvidence: true,
          weather: true,
          fires: true,
        },
      })
    if (path === '/api/dashboard')
      return json(
        await engine.dashboard(
          placeFromParams(url.searchParams),
          planningDate(url.searchParams.get('date')),
        ),
      )
    if (path.startsWith('/api/context/')) {
      if (mode === 'context-error')
        return json({ error: 'SYNTHETIC context outage' }, 503)
      const family = path.split('/').at(-1),
        selectedDate = planningDate(url.searchParams.get('date'))
      const value =
        family === 'weather'
          ? {
              ...weather,
              fetchedAt:
                mode === 'stale-weather'
                  ? new Date(now - 8 * 3600000).toISOString()
                  : fetchedAt,
              points: weather.points.filter(
                (p) =>
                  new Date(p.time).toLocaleDateString('sv-SE', {
                    timeZone: 'Asia/Kolkata',
                  }) === selectedDate,
              ),
            }
          : {
              ...fires,
              detections: mode === 'empty-fires' ? [] : fires.detections,
            }
      return json({
        schemaVersion: 1,
        family,
        status:
          family === 'fires' && !value.detections.length
            ? 'no_detections'
            : 'available',
        lastAttemptAt: fetchedAt,
        lastSuccessAt: value.fetchedAt,
        evidence: value,
      })
    }
    if (path === '/api/public/evidence' || path === '/api/public/widget') {
      if (mode === 'public-error')
        return json({ error: 'SYNTHETIC public refresh outage' }, 503)
      publicArea(url.searchParams)
      const chosenDate = planningDate(url.searchParams.get('date'))
      const value = publicProjection(
        await engine.dashboard(place, chosenDate),
        chosenDate,
      )
      value.forecast.source = 'SYNTHETIC browser forecast fixture'
      value.guidance = `SYNTHETIC BROWSER QA DATA. ${value.guidance}`
      value.observations = [
        {
          source: 'OpenAQ',
          station: 'SYNTHETIC station <script>fixture</script>',
          value: 0,
          unit: 'µg/m³',
          observedAt: fetchedAt,
          stale: false,
          statistic: 'hourly_mean',
          period: {
            start: new Date(now - 3600000).toISOString(),
            end: fetchedAt,
          },
          qualityFlags: ['SYNTHETIC fixture'],
          attribution: 'https://openaq.org/',
        },
      ]
      if (path.endsWith('/widget')) {
        const out = widgetResponse(value)
        reply.writeHead(out.statusCode, out.headers)
        return reply.end(out.body)
      }
      return json(value)
    }
    if (path === '/api/unsubscribe' && request.method === 'POST')
      return json(await unsubscribe((await body(request)).token, store, secret))
    if (path.startsWith('/api/workspace')) {
      if (request.headers.authorization !== 'Bearer synthetic-browser-token')
        return json({ error: 'Synthetic session required' }, 401)
      if (mode === 'revoked')
        return json(
          {
            error: 'Synthetic membership revoked',
            code: 'workspace_membership_revoked',
          },
          403,
        )
      if (
        path === '/api/workspace' &&
        request.method === 'GET' &&
        failNextWorkspaceRead
      ) {
        failNextWorkspaceRead = false
        return json({ error: 'SYNTHETIC refresh failed after save' }, 503)
      }
      const payload = await body(request)
      const result = path.endsWith('/subscriptions')
        ? await subscriptionsRoute(
            request.method,
            payload,
            member,
            store,
            secret,
          )
        : await workspaceRoute(request.method, path, payload, member, store)
      if (mode === 'save-refresh-error' && request.method !== 'GET')
        failNextWorkspaceRead = true
      return json(result)
    }
    if (path.startsWith('/api/'))
      return json({ error: 'Not included in synthetic browser review' }, 404)
    const file = resolve(root, `.${decodeURIComponent(path)}`)
    if (file !== root && !file.startsWith(root + sep))
      return json({ error: 'Invalid fixture path' }, 400)
    const target = extname(file) ? file : resolve(root, 'index.html')
    let bytes = await readFile(target)
    if (target.endsWith('index.html'))
      bytes = Buffer.from(bytes.toString().replace('<body>', '<body>' + banner))
    reply.writeHead(200, {
      'content-type': mime[extname(target)] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    reply.end(bytes)
  } catch (error) {
    json({ error: error.message }, error.status || 503)
  }
})
server.listen(5175, '127.0.0.1', () =>
  console.log(
    'SYNTHETIC R3 browser QA: http://127.0.0.1:5175/qa (no real providers, accounts or email)',
  ),
)
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)))
