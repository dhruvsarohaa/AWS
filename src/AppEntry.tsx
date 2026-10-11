import { lazy, Suspense } from 'react'
const App = lazy(() => import('./App.tsx'))
const PublicDisplay = lazy(() => import('./components/PublicDisplay.tsx'))
const Unsubscribe = lazy(() => import('./components/Unsubscribe.tsx'))
export default function AppEntry() {
  const params = new URLSearchParams(location.search)
  return (
    <Suspense fallback={<p role="status">Loading Airday…</p>}>
      {params.get('email-action') === 'unsubscribe' ? (
        <Unsubscribe />
      ) : params.get('display') === '1' ? (
        <PublicDisplay />
      ) : (
        <App />
      )}
    </Suspense>
  )
}
