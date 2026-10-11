import { runtime } from './runtime.mjs'
import { evaluateDue } from './alert-dispatcher.mjs'
export async function handler() {
  const { engine, store, context } = await runtime()
  await engine.dispatch()
  await context.dispatch()
  await evaluateDue(store, engine)
  return { ok: true }
}
