import { getStore } from './store.mjs'
import { makeTransport } from './transport.mjs'
import { credentials, enqueue, archive } from './services.mjs'
import { createEngine } from './engine.mjs'
import { createContext } from './context.mjs'
import { createDeviceService } from './r5-devices.mjs'
import { deviceProfiles } from './pilot-config.mjs'
export async function runtime() {
  const store = await getStore()
  const dependencies = {
    store,
    request: makeTransport(store),
    keys: credentials,
    enqueue,
    archive,
  }
  const engine = createEngine(dependencies)
  return {
    store,
    engine,
    context: createContext({ ...dependencies, engine }),
    devices: createDeviceService({ store, profiles: deviceProfiles }),
  }
}
