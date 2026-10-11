import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppEntry from './AppEntry.tsx'
import AppErrorBoundary from './components/AppErrorBoundary.tsx'
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        const announce = () =>
          window.dispatchEvent(new Event('airday-update-ready'))
        if (registration.waiting) announce()
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing
          worker?.addEventListener('statechange', () => {
            if (
              worker.state === 'installed' &&
              navigator.serviceWorker.controller
            )
              announce()
          })
        })
      })
      .catch(() => window.dispatchEvent(new Event('airday-offline-error')))
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppEntry />
    </AppErrorBoundary>
  </StrictMode>,
)
