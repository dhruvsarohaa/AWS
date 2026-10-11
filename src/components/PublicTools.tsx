import type { Place } from '../types.ts'
export default function PublicTools({
  place,
  enabled,
}: {
  place: Place
  enabled: boolean
}) {
  const area = `${(Math.round(place.latitude * 10) / 10).toFixed(1)},${(Math.round(place.longitude * 10) / 10).toFixed(1)}`,
    query = new URLSearchParams({ area }),
    display = `${location.origin}/?display=1&${query}`,
    API = import.meta.env.VITE_API_BASE_URL || ''
  if (!enabled) return null
  return (
    <section className="card" id="public-tools" tabIndex={-1}>
      <h2>Public evidence display & integration</h2>
      <p>
        Public links contain a rounded area only. They show source evidence,
        timestamps and general guidance. Your timetable, reasons, membership and
        exact detected GPS are excluded.
      </p>
      <div className="button-row">
        <a
          className="button secondary"
          href={display}
          target="_blank"
          rel="noreferrer"
        >
          Open public display
        </a>
        <a
          className="button secondary"
          href={`${API}/api/public/evidence?${query}`}
          target="_blank"
          rel="noreferrer"
        >
          Public JSON · schema 1
        </a>
        <a
          className="button secondary"
          href={`${API}/api/public/widget?${query}`}
          target="_blank"
          rel="noreferrer"
        >
          Public widget snapshot
        </a>
      </div>
      <label>
        Shareable display URL
        <input readOnly value={display} onFocus={(e) => e.target.select()} />
      </label>
      <p className="help-text">
        Embedding requires an explicitly approved HTTPS origin on the server.
        The main application retains its frame protection. Widgets show a dated
        snapshot and require reload.
      </p>
    </section>
  )
}
