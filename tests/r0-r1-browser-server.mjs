// Disposable, isolated R0/R1 browser verification. No .env, credentials or external requests.
// Build the application first, then run node tests/r0-r1-browser-server.mjs.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { hash } from '../api/core.mjs'
import { dateInIndia, STARTER_PLAN } from '../src/lib/planner.ts'
import { validDashboard } from '../src/lib/contracts.ts'

const root = resolve('dist'),
  port = 5176
let scenario = 'fresh',
  responseDelay = 0
const place = {
  name: 'SYNTHETIC Delhi',
  state: 'Delhi',
  country: 'India',
  latitude: 28.6139,
  longitude: 77.209,
  confirmed: true,
}
const pune = {
  name: 'SYNTHETIC Pune',
  state: 'Maharashtra',
  country: 'India',
  latitude: 18.5204,
  longitude: 73.8567,
  confirmed: true,
}
const plan = {
  ...STARTER_PLAN,
  name: 'SYNTHETIC acceptance plan',
  configured: true,
  ruleMode: 'custom',
  activities: [
    {
      id: 'qa-walk',
      activity: 'SYNTHETIC morning walk',
      place: 'SYNTHETIC park',
      start: '08:00',
      end: '09:00',
      days: [0, 1, 2, 3, 4, 5, 6],
      flexible: true,
      allowedStart: '07:00',
      allowedEnd: '12:00',
      indoorAvailable: true,
      intensity: 'moderate',
    },
  ],
}
const state = {
  plan,
  journal: [],
  oneOffs: [],
  dismissedAlerts: [],
  language: 'en',
  favorites: [],
  feedback: [],
  groups: [],
}
const makeDashboard = (selected, mode, planningDate) => {
  const now = Date.now(),
    fetchedAt = new Date(now).toISOString(),
    day = dateInIndia(now)
  const points = Array.from({ length: 72 }, (_, i) => {
    const date = new Date(Date.parse(`${day}T00:00:00Z`) + i * 3600000)
      .toISOString()
      .slice(0, 16)
    const hour = i % 24,
      value = hour >= 7 && hour < 10 ? 100 : hour >= 10 && hour < 12 ? 25 : 55
    return {
      time: `${date}:00+05:30`,
      pm25:
        mode === 'partial' && hour === 8
          ? null
          : mode === 'below-rule'
            ? 40
            : value,
      pm10: value * 1.7,
    }
  })
  const forecast = {
    id: hash(points),
    points,
    fetchedAt:
      mode === 'stale-forecast'
        ? new Date(now - 4 * 3600000).toISOString()
        : fetchedAt,
    timezone: 'Asia/Kolkata',
    grid: {
      latitude: Math.round(selected.latitude * 10) / 10,
      longitude: Math.round(selected.longitude * 10) / 10,
    },
    source: 'SYNTHETIC QA regional forecast; not live evidence',
  }
  const monitor = {
    source: 'OpenAQ',
    station: 'SYNTHETIC QA station',
    latitude: selected.latitude,
    longitude: selected.longitude,
    distanceKm: 2,
    pollutant: 'PM2.5',
    value: 42,
    unit: 'µg/m³',
    observedAt: new Date(
      now - (mode === 'old-monitor' ? 5 * 3600000 : 30 * 60000),
    ).toISOString(),
    stale: mode === 'old-monitor',
    url: 'https://openaq.org',
    id: 'synthetic-qa',
    owner: 'Synthetic QA',
    statistic: 'instantaneous',
    qualityStatus: 'verified',
  }
  const openaq = {
    status:
      mode === 'failed-retained'
        ? 'unavailable'
        : mode === 'queued'
          ? 'pending'
          : mode === 'forecast-only'
            ? 'no_data'
            : 'live',
    message:
      mode === 'failed-retained'
        ? 'SYNTHETIC provider outage; retained observation keeps original time.'
        : 'SYNTHETIC QA evidence only.',
    lastAttemptAt: fetchedAt,
    lastSuccessAt: new Date(now - 60000).toISOString(),
  }
  const data = {
    schemaVersion: 2,
    snapshotId: hash({ selected, mode, points }),
    pending: mode === 'queued',
    location: mode === 'wrong-location' ? pune : selected,
    forecast: ['no-data', 'queued', 'observations-only'].includes(mode)
      ? null
      : forecast,
    monitors: ['no-data', 'queued', 'forecast-only'].includes(mode)
      ? []
      : [monitor],
    sources: {
      forecast: {
        status:
          mode === 'queued'
            ? 'pending'
            : mode === 'no-data'
              ? 'unavailable'
              : 'live',
        message: 'SYNTHETIC QA forecast only.',
        lastAttemptAt: fetchedAt,
        lastSuccessAt: fetchedAt,
      },
      openaq,
      cpcb: {
        status: 'not_configured',
        message: 'CPCB disabled in synthetic QA.',
      },
    },
    policy: {
      date: planningDate || day,
      version: 'synthetic-unverified',
      status: 'unverified',
      message: 'SYNTHETIC QA. No official orders are encoded.',
      records: [],
      sources: [],
    },
  }
  if (!validDashboard(data)) throw new Error('Invalid QA dashboard fixture')
  if (mode === 'invalid-unit') data.monitors[0].unit = 'AQI'
  return data
}
const controls = `<style>@media print { aside[aria-label="Synthetic QA controls"] { display: none !important; } }</style><aside style="padding:12px;background:#fff3cf;color:#302b1d;border-bottom:2px solid #c08e24;font:14px system-ui" aria-label="Synthetic QA controls"><strong>SYNTHETIC QA — isolated browser data; no providers or AWS</strong> <a href="/qa">Storage inspector</a><label> Evidence scenario <select id="qa-scenario">${['fresh', 'below-rule', 'slow', 'forecast-only', 'old-monitor', 'failed-retained', 'queued', 'no-data', 'observations-only', 'partial', 'stale-forecast', 'wrong-location', 'invalid-unit', 'http-error'].map((x) => `<option>${x}</option>`).join('')}</select></label> <button id="qa-apply">Apply evidence scenario</button> <button id="qa-fail-write">Fail next planning write</button> <output id="qa-status" role="status"></output></aside><script src="/qa-controls.js"></script>`
const controlsJs = `fetch('/qa/scenario').then(r=>r.json()).then(v=>{document.getElementById('qa-scenario').value=v.scenario});document.getElementById('qa-apply').onclick=async()=>{await fetch('/qa/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:document.getElementById('qa-scenario').value})});document.getElementById('qa-status').textContent='Scenario changed. Use the app Refresh button to retrieve it.'};
document.getElementById('qa-fail-write').onclick=()=>{const original=IDBObjectStore.prototype.put;let pending=true;IDBObjectStore.prototype.put=function(value,key){if(pending&&this.transaction.db.name==='airday-planning'&&key==='planning'){pending=false;IDBObjectStore.prototype.put=original;throw new DOMException('Synthetic test quota failure','QuotaExceededError')}return original.call(this,value,key)};document.getElementById('qa-status').textContent='Next planning write will fail in this QA tab only.'};`
const inspector = `<!doctype html><html lang="en"><meta charset="UTF-8"><title>R0/R1 synthetic storage inspector</title><body style="font:16px system-ui;margin:24px;max-width:1000px">${controls}<h1>R0/R1 synthetic storage inspector</h1><p>This separate localhost origin contains disposable test data. No credentials, user records, providers or AWS.</p><p><a href="/">Open app</a></p><button id="seed-clean">Seed clean R1 plan</button> <button id="seed-v1">Seed legacy v1 document</button> <button id="seed-corrupt">Seed unknown schema document</button> <button id="inspect">Inspect stored document</button><p role="status" id="message"></p><pre id="result" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre><script src="/qa-inspector.js"></script></body></html>`
const inspectorJs = `const state=${JSON.stringify(state)},place=${JSON.stringify(place)};
function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open('airday-planning',1);r.onupgradeneeded=()=>r.result.createObjectStore('documents');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function seed(kind){const db=await open();const doc=kind==='corrupt'?{schemaVersion:99,revision:7,privateOriginal:'SYNTHETIC recovery fixture',state:{bad:true}}:kind==='v1'?{schemaVersion:1,revision:4,state:{plan:state.plan,journal:[],oneOffs:[],dismissedAlerts:[],language:'en'}}:{schemaVersion:2,revision:0,state};await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(doc,'planning');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close();localStorage.setItem('airday-place',JSON.stringify(place));document.getElementById('message').textContent='Seeded SYNTHETIC '+kind+'; open or reload the app.';await inspect()}
async function inspect(){const db=await open();const docs=await new Promise((resolve,reject)=>{const tx=db.transaction('documents','readonly'),s=tx.objectStore('documents'),kr=s.getAllKeys(),vr=s.getAll();tx.oncomplete=()=>resolve(kr.result.map((key,i)=>({key,value:vr.result[i]})));tx.onabort=()=>reject(tx.error)});db.close();document.getElementById('result').textContent=JSON.stringify(docs,null,2)}
document.getElementById('seed-clean').onclick=()=>seed('clean');document.getElementById('seed-v1').onclick=()=>seed('v1');document.getElementById('seed-corrupt').onclick=()=>seed('corrupt');document.getElementById('inspect').onclick=inspect;`
const json = (res, value, status = 200) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://127.0.0.1:${port}`)
    if (u.pathname === '/qa/scenario' && req.method === 'GET')
      return json(res, { scenario })
    if (u.pathname === '/qa/scenario' && req.method === 'POST') {
      let raw = ''
      for await (const c of req) raw += c
      const input = JSON.parse(raw)
      scenario = input.scenario
      responseDelay = scenario === 'slow' ? 10000 : 0
      return json(res, { scenario })
    }
    if (u.pathname === '/api/config')
      return json(res, {
        schemaVersion: 2,
        auth: null,
        capabilities: {
          weather: false,
          fireContext: false,
          publicViews: false,
          reviewEmail: false,
          r4: { cleanRouting: false },
          r5: { indoorDevices: false },
        },
      })
    if (u.pathname === '/api/search')
      return json(res, {
        results: u.searchParams.get('q')?.toLowerCase().includes('pune')
          ? [pune]
          : [place],
      })
    if (u.pathname === '/api/dashboard') {
      if (scenario === 'http-error')
        return json(res, { error: 'SYNTHETIC HTTP outage' }, 503)
      const selected = {
        ...place,
        name: u.searchParams.get('city') || place.name,
        state: u.searchParams.get('state') || place.state,
        latitude: Number(u.searchParams.get('lat')),
        longitude: Number(u.searchParams.get('lon')),
      }
      const data = makeDashboard(selected, scenario, u.searchParams.get('date'))
      if (responseDelay) await new Promise((r) => setTimeout(r, responseDelay))
      return json(res, data)
    }
    if (u.pathname.startsWith('/api/'))
      return json(
        res,
        { error: 'This endpoint is outside R0/R1 synthetic QA.' },
        503,
      )
    if (['/qa', '/qa-controls.js', '/qa-inspector.js'].includes(u.pathname)) {
      res.writeHead(200, {
        'content-type':
          u.pathname === '/qa'
            ? 'text/html; charset=utf-8'
            : 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      })
      return res.end(
        u.pathname === '/qa'
          ? inspector
          : u.pathname === '/qa-controls.js'
            ? controlsJs
            : inspectorJs,
      )
    }
    const path = resolve(
      root,
      '.' + decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname),
    )
    if (!path.startsWith(root + sep))
      return json(res, { error: 'Not found' }, 404)
    const buffer = await readFile(path)
    const mime =
      {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.webmanifest': 'application/manifest+json',
      }[extname(path)] || 'application/octet-stream'
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' })
    const blockStorage =
      u.searchParams.get('storage') === 'unavailable'
        ? `<script>Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('SYNTHETIC QA blocked storage','SecurityError')}})</script>`
        : ''
    res.end(
      extname(path) === '.html'
        ? buffer
            .toString()
            .replace('<body>', '<body>' + controls)
            .replace('<head>', '<head>' + blockStorage)
        : buffer,
    )
  } catch (error) {
    json(
      res,
      {
        error:
          error.code === 'ENOENT' ? 'Not found' : 'Synthetic QA server failure',
      },
      error.code === 'ENOENT' ? 404 : 500,
    )
  }
})
server.listen(port, '127.0.0.1', () =>
  console.log(`SYNTHETIC R0/R1 browser QA http://127.0.0.1:${port}/qa`),
)
