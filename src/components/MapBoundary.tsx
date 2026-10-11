import { Component } from 'react'
import type { ReactNode } from 'react'
/** A failed optional map chunk must not replace the planner with the global error screen. */
export default class MapBoundary extends Component<
  { children: ReactNode; message: string },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <p role="alert" className="coverage-warning">
        {this.props.message}
      </p>
    ) : (
      this.props.children
    )
  }
}
