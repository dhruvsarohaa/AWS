export function createRequestScope() {
  let generation = 0
  let controller = new AbortController()

  return {
    capture() {
      const capturedGeneration = generation,
        signal = controller.signal
      return {
        signal,
        isCurrent: () => capturedGeneration === generation && !signal.aborted,
      }
    },
    invalidate() {
      generation += 1
      controller.abort()
      controller = new AbortController()
    },
  }
}
