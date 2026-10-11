import { Component } from 'react'
import type { ReactNode } from 'react'
export default class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed)
      return (
        <main className="main-content">
          <section className="card">
            <h1>Airday could not display this page</h1>
            <p>
              Your saved planning data has not been cleared. Reload to try
              again; if the issue repeats, keep this browser’s data for
              recovery.
            </p>
            <button
              type="button"
              className="button primary"
              onClick={() => window.location.reload()}
            >
              Reload Airday
            </button>
          </section>
        </main>
      )
    return this.props.children
  }
}
