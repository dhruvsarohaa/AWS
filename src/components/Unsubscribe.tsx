import { useState } from 'react'
import './R3.css'
import '../glass.css'
export default function Unsubscribe() {
  const [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false)
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || ''
  return (
    <main className="public-display">
      <h1>Stop scheduled Airday emails</h1>
      <p>
        Confirm to disable review alerts and daily briefs for this subscription.
        Sign-in is not required.
      </p>
      <button
        className="button secondary"
        type="button"
        disabled={busy || done || !token}
        onClick={async () => {
          setBusy(true)
          try {
            const r = await fetch(
              `${import.meta.env.VITE_API_BASE_URL || ''}/api/unsubscribe`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token }),
                signal: AbortSignal.timeout(15000),
              },
            )
            const b = await r.json()
            if (!r.ok) throw new Error(b.error || 'Unsubscribe failed.')
            setDone(true)
            setNotice('Scheduled emails disabled.')
          } catch (e) {
            setNotice(e instanceof Error ? e.message : 'Unsubscribe failed.')
          } finally {
            setBusy(false)
          }
        }}
      >
        Confirm unsubscribe
      </button>
      <p role="status">
        {notice || (!token ? 'This link has no unsubscribe token.' : '')}
      </p>
    </main>
  )
}
