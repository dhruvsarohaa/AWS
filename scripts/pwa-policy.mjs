/** Only the public planner shell may fall back offline. Private/action URLs and
 * arbitrary query parameters must keep their normal network behavior. */
export function plannerShellNavigation(url) {
  if (!['/', '/index.html'].includes(url.pathname)) return false
  if ([...url.searchParams.keys()].some((key) => key !== 'date')) return false
  const dates = url.searchParams.getAll('date')
  if (dates.length > 1) return false
  if (!dates.length) return true
  const date = dates[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const instant = Date.parse(`${date}T12:00:00Z`)
  return (
    Number.isFinite(instant) &&
    new Date(instant).toISOString().slice(0, 10) === date
  )
}

export function precacheAsset(name) {
  return (
    /\.(?:js|css|png|svg|woff2)$/.test(name) &&
    !/^R3-.*\.js$/i.test(name) &&
    !/^(?:StationMap|FireMap|leaflet|R4JourneyPanel|R5DevicesPanel|r4-journey-store|PublicDisplay|Unsubscribe)-/i.test(
      name,
    )
  )
}

/** Follow the built public shell's static imports, including its lazy App entry.
 * Optional maps/auth/display pages are not public planner startup dependencies. */
export function requiredShellAssets(manifest) {
  if (!manifest['index.html'] || !manifest['src/App.tsx'])
    throw new Error(
      'The public planner entries are missing from the build manifest.',
    )
  const seen = new Set(),
    files = new Set()
  const visit = (key) => {
    if (seen.has(key)) return
    seen.add(key)
    const entry = manifest[key]
    if (!entry) throw new Error(`Missing static build dependency: ${key}`)
    for (const name of [
      entry.file,
      ...(entry.css || []),
      ...(entry.assets || []),
    ])
      if (name && name !== 'index.html') files.add(`/${name}`)
    for (const dependency of entry.imports || []) visit(dependency)
  }
  visit('index.html')
  visit('src/App.tsx')
  return [...files]
}
