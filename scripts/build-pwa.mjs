import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import {
  plannerShellNavigation,
  precacheAsset,
  requiredShellAssets,
} from './pwa-policy.mjs'
// Code-drawn PNG icons; no external images or third-party runtime dependency.
function crc(bytes) {
  let v = 0xffffffff
  for (const b of bytes) {
    v ^= b
    for (let n = 0; n < 8; n++) v = (v >>> 1) ^ (v & 1 ? 0xedb88320 : 0)
  }
  return (v ^ 0xffffffff) >>> 0
}
function chunk(type, bytes) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    check = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  check.writeUInt32BE(crc(Buffer.concat([name, bytes])))
  return Buffer.concat([length, name, bytes, check])
}
function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const offset = y * (size * 4 + 1) + 1 + x * 4,
        dx = x / size - 0.5,
        dy = y / size - 0.5,
        background = dx * dx + dy * dy < 0.22,
        leaf =
          ((dx + 0.03) * (dx + 0.03)) / 0.035 +
            ((dy + 0.08) * (dy + 0.08)) / 0.08 <
            1 && dy < 0.2,
        stem = Math.abs(dx + dy * 0.42) < 0.013 && dy > -0.23 && dy < 0.31
      const c = stem
        ? [229, 244, 216]
        : leaf
          ? [180, 218, 162]
          : background
            ? [32, 93, 77]
            : [247, 248, 243]
      raw.set([...c, 255], offset)
    }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
for (const size of [192, 512]) {
  const png = icon(size)
  await writeFile(`public/icon-${size}.png`, png)
  await writeFile(`dist/icon-${size}.png`, png)
}
const assets = (await readdir('dist/assets'))
  // Map chunks remain lazy and are not prefetched into the offline shell.
  .filter(precacheAsset)
  .map((n) => `/assets/${n}`)
const notices =
  'Leaflet 1.9.4 (bundled map controls)\n\n' +
  (await readFile('node_modules/leaflet/LICENSE', 'utf8')) +
  '\n\nBasemap: © OpenStreetMap contributors. https://www.openstreetmap.org/copyright\nTile use: https://operations.osmfoundation.org/policies/tiles/\nNo offline tile downloads or bulk prefetch. Public tiles are a best-effort pilot dependency.\n' +
  '\n\nManrope — Google Fonts\nSource: https://fonts.google.com/specimen/Manrope\n\n' +
  (await readFile('src/assets/fonts/Manrope-OFL.txt', 'utf8')) +
  '\n\nArchivo Black — Google Fonts\nSource: https://fonts.google.com/specimen/Archivo+Black\n\n' +
  (await readFile('src/assets/fonts/ArchivoBlack-OFL.txt', 'utf8')) +
  '\n\nGSAP — Copyright (c) 2008-2026, GreenSock. All rights reserved.\n@gsap/react — Copyright (c) 2008-2025, GreenSock. All rights reserved.\nLicense: https://gsap.com/standard-license/\nSource: https://github.com/greensock/GSAP and https://github.com/greensock/react\n'
await writeFile('public/third-party-notices.txt', notices)
await writeFile('dist/third-party-notices.txt', notices)
const files = [
    '/index.html',
    '/favicon.svg',
    '/manifest.webmanifest',
    '/icon-192.png',
    '/icon-512.png',
    '/third-party-notices.txt',
    ...assets,
  ],
  digest = createHash('sha256')
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'))
const missing = requiredShellAssets(manifest).filter((f) => !files.includes(f))
if (missing.length)
  throw new Error(
    `Offline shell is missing startup dependencies: ${missing.join(', ')}`,
  )
for (const f of files) digest.update(await readFile(`dist${f}`))
const version = digest.digest('hex').slice(0, 16)
const worker = `const CACHE='airday-shell-${version}',FILES=${JSON.stringify(files)},ALLOW=new Set(FILES);
const plannerShellNavigation=${plannerShellNavigation.toString()};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>new Request(f,{cache:'reload'}))))));
// Default waiting lifecycle preserves active pages/drafts. No skipWaiting or automatic reload.
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('airday-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==self.location.origin||r.headers.has('authorization')||u.pathname.startsWith('/api/'))return;
if(r.mode==='navigate'){if(!plannerShellNavigation(u))return;e.respondWith(caches.open(CACHE).then(async c=>(await c.match('/index.html'))||fetch(r)));return;}
if(u.search)return;
if(ALLOW.has(u.pathname))e.respondWith(caches.open(CACHE).then(async c=>(await c.match(u.pathname))||fetch(r)));});
`
await writeFile('dist/sw.js', worker)
console.log(
  `Offline shell generated (${files.length} static assets, ${version}); API and map requests excluded.`,
)
