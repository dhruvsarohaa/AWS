import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalState } from '../types.ts'
import {
  legacyLocalState,
  loadLocalDocument,
  LocalConflict,
  LocalRecovery,
  recoverLocalDocument,
  validLocalState,
  writeLocalDocument,
} from '../lib/localRepository.ts'
import type {
  LocalDocument,
  LocalRecoverySource,
} from '../lib/localRepository.ts'

export function useLocalRepository() {
  const [document, setDocument] = useState<LocalDocument>(() => ({
    schemaVersion: 2,
    revision: 0,
    state: legacyLocalState(),
  }))
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false)
  const [mutation, setMutation] = useState(0)
  const [issue, setIssue] = useState(''),
    [sessionOnly, setSessionOnly] = useState(false),
    [conflict, setConflict] = useState(false),
    [recoveryRequired, setRecoveryRequired] = useState(false)
  const current = useRef(document),
    blocked = useRef(false),
    writing = useRef(false),
    initialized = useRef(false)
  const generation = useRef(0),
    preserveStored = useRef(false)
  const recovery = useRef<LocalRecoverySource | undefined>(undefined)
  const latestRevision = useRef(0)
  const channel = useRef<BroadcastChannel | null>(null)
  const invalidateGeneration = useCallback(() => {
    generation.current++
  }, [])
  const apply = useCallback((next: LocalDocument) => {
    current.current = next
    setDocument(next)
    setMutation((x) => x + 1)
  }, [])
  useEffect(() => {
    const id = ++generation.current
    let active = true
    let broadcast: BroadcastChannel | null = null
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('airday-planning-revisions')
      broadcast = channel.current
      channel.current.onmessage = (event) => {
        if (!active || !initialized.current) return
        if (
          !Number.isSafeInteger(event.data?.revision) ||
          event.data.revision <= current.current.revision
        )
          return
        latestRevision.current = event.data.revision
        blocked.current = true
        setConflict(true)
        setIssue(
          'Another tab saved planning data. Export this session or reload stored data before editing.',
        )
      }
    }
    void loadLocalDocument()
      .then((next) => {
        if (active && id === generation.current) {
          apply(next)
          channel.current?.postMessage({ revision: next.revision })
        }
      })
      .catch((error) => {
        if (active && id === generation.current) {
          preserveStored.current = error instanceof LocalRecovery
          recovery.current =
            error instanceof LocalRecovery ? error.source : undefined
          setRecoveryRequired(Boolean(recovery.current))
          setIssue(error.message)
          setSessionOnly(true)
        }
      })
      .finally(() => {
        if (active && id === generation.current) {
          initialized.current = true
          setReady(true)
        }
      })
    return () => {
      active = false
      invalidateGeneration()
      broadcast?.close()
      channel.current = null
    }
  }, [apply, invalidateGeneration])
  const commit = useCallback(
    async (next: LocalState): Promise<'saved' | 'session' | 'conflict'> => {
      if (!validLocalState(next)) {
        setIssue('Planning data failed validation. The change was not saved.')
        return 'conflict'
      }
      if (!initialized.current || blocked.current || writing.current)
        return 'conflict'
      writing.current = true
      setBusy(true)
      const expected = current.current.revision,
        id = generation.current
      try {
        if (preserveStored.current)
          throw new LocalRecovery(
            'Stored data needs recovery. Your complete change remains in this session; export it before leaving.',
          )
        const saved = await writeLocalDocument(next, expected)
        if (id !== generation.current) return 'conflict'
        apply(saved)
        setSessionOnly(false)
        if (latestRevision.current <= saved.revision) {
          blocked.current = false
          setConflict(false)
          setIssue('')
        }
        channel.current?.postMessage({ revision: saved.revision })
        return 'saved'
      } catch (error) {
        if (id !== generation.current) return 'conflict'
        if (error instanceof LocalConflict) {
          blocked.current = true
          setConflict(true)
          setIssue(error.message)
          return 'conflict'
        }
        if (error instanceof LocalRecovery && error.source) {
          preserveStored.current = true
          recovery.current = error.source
          setRecoveryRequired(true)
        }
        // Preserve plan + record + evidence as one complete session state.
        apply({
          schemaVersion: 2,
          revision: expected,
          state: structuredClone(next),
        })
        setSessionOnly(true)
        setIssue(
          error instanceof Error ? error.message : 'Browser saving failed.',
        )
        return 'session'
      } finally {
        writing.current = false
        if (id === generation.current) setBusy(false)
      }
    },
    [apply],
  )
  const reload = useCallback(async () => {
    if (writing.current) return
    writing.current = true
    setBusy(true)
    const id = generation.current
    try {
      const next = await loadLocalDocument()
      if (id !== generation.current) return
      apply(next)
      preserveStored.current = false
      recovery.current = undefined
      setRecoveryRequired(false)
      latestRevision.current = next.revision
      blocked.current = false
      setConflict(false)
      setSessionOnly(false)
      setIssue('')
    } catch (error) {
      if (id === generation.current) {
        if (error instanceof LocalRecovery) {
          preserveStored.current = true
          recovery.current = error.source
          setRecoveryRequired(Boolean(error.source))
          setSessionOnly(true)
        }
        setIssue(
          error instanceof Error
            ? error.message
            : 'Stored data could not load.',
        )
      }
    } finally {
      writing.current = false
      if (id === generation.current) setBusy(false)
    }
  }, [apply])
  const recover = useCallback(
    async (next: LocalState): Promise<'saved' | 'session' | 'conflict'> => {
      if (
        !initialized.current ||
        writing.current ||
        blocked.current ||
        !recovery.current
      )
        return 'conflict'
      writing.current = true
      setBusy(true)
      const id = generation.current
      try {
        const saved = await recoverLocalDocument(next, recovery.current)
        if (id !== generation.current) return 'conflict'
        apply(saved)
        preserveStored.current = false
        recovery.current = undefined
        latestRevision.current = saved.revision
        blocked.current = false
        setRecoveryRequired(false)
        setConflict(false)
        setSessionOnly(false)
        setIssue('')
        channel.current?.postMessage({ revision: saved.revision })
        return 'saved'
      } catch (error) {
        if (id === generation.current) {
          if (error instanceof LocalConflict) {
            blocked.current = true
            setConflict(true)
          }
          setIssue(
            error instanceof Error
              ? error.message
              : 'Stored planning recovery failed.',
          )
        }
        return 'conflict'
      } finally {
        writing.current = false
        if (id === generation.current) setBusy(false)
      }
    },
    [apply],
  )
  return {
    state: document.state,
    revision: document.revision,
    mutation,
    ready,
    busy,
    issue,
    sessionOnly,
    conflict,
    recoveryRequired,
    commit,
    reload,
    recover,
  }
}
