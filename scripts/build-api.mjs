import { build } from 'esbuild'
import { mkdir, cp } from 'node:fs/promises'
import { resolve } from 'node:path'

const outdir = resolve('.airday-build/api')
await mkdir(outdir, { recursive: true })
await build({
  entryPoints: [
    'api/handler.mjs',
    'api/worker.mjs',
    'api/dispatcher.mjs',
    'api/notifications.mjs',
    'api/delivery-events.mjs',
  ],
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
})
await cp('api/config', resolve(outdir, 'config'), { recursive: true })
console.log(
  'API bundles and reviewed configuration are ready for SAM deployment.',
)
