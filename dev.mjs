import { spawn } from 'node:child_process'

const env = { ...process.env }
const port = env.AIRDAY_PORT || '5174'
const api = spawn(process.execPath, ['--watch', 'api/local-server.mjs'], {
  stdio: 'inherit',
  env,
})
const vite = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    '--host',
    '127.0.0.1',
    '--port',
    port,
    '--strictPort',
  ],
  { stdio: 'inherit', env },
)
let stopping = false

function stop(code = 0) {
  if (stopping) return
  stopping = true
  api.kill('SIGTERM')
  vite.kill('SIGTERM')
  setTimeout(() => process.exit(code), 100)
}

api.on('error', (error) => {
  console.error(error)
  stop(1)
})
vite.on('error', (error) => {
  console.error(error)
  stop(1)
})
api.on('exit', (code) => {
  if (!stopping && code !== 0) stop(code || 1)
})
vite.on('exit', (code) => {
  if (!stopping) stop(code || 0)
})
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
