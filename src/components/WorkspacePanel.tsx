import { useEffect, useRef, useState } from 'react'
import {
  captureSession,
  finishSignIn,
  onSessionEnd,
  signIn,
  signedIn,
  signOut,
  workspaceRequest,
} from '../lib/auth.ts'
import type { AuthConfig } from '../lib/auth.ts'
import { createRequestScope } from '../lib/requestScope.ts'
import type {
  DecisionRecord,
  OutdoorPlan,
  OneOffPlan,
  Place,
} from '../types.ts'
import { planVersion } from '../lib/planner.ts'
import { SharedGroups } from './GroupView.tsx'
import { readWorkspace } from '../lib/workspace-contract.ts'
import type { Workspace } from '../lib/workspace-contract.ts'
import NotificationSettings from './NotificationSettings.tsx'

export default function WorkspacePanel({
  plan,
  journal,
  onLoad,
  oneOffs = [],
  place,
  onSelectPlace,
}: {
  plan: OutdoorPlan
  journal: DecisionRecord[]
  onLoad: (plan: OutdoorPlan) => Promise<void>
  oneOffs?: OneOffPlan[]
  place?: Place
  onSelectPlace?: (place: Place) => void
}) {
  const [config, setConfig] = useState<AuthConfig | null>(null),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [refreshRequired, setRefreshRequired] = useState(false),
    [selectedRecord, setSelectedRecord] = useState(''),
    [replacement, setReplacement] = useState(''),
    [reopenReasons, setReopenReasons] = useState<Record<string, string>>({})
  const requests = useRef(createRequestScope())
  const [configAttempt, setConfigAttempt] = useState(0)
  const [configLoading, setConfigLoading] = useState(true)
  useEffect(() => {
    const scope = requests.current,
      request = scope.capture(),
      unsubscribe = onSessionEnd((reason) => {
        scope.invalidate()
        setWorkspace(null)
        setRefreshRequired(false)
        setReopenReasons({})
        setSelectedRecord('')
        setReplacement('')
        setBusy(false)
        setError('')
        setNotice(
          reason === 'expired'
            ? 'Your workspace session expired. Sign in again.'
            : reason === 'revoked'
              ? 'Workspace membership was revoked. Contact its owner.'
              : 'Signed out on this browser.',
        )
      })
    fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/config`, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    })
      .then((response) => {
        if (!response.ok)
          throw new Error('Shared workspace configuration is unavailable.')
        return response.json()
      })
      .then(async (body) => {
        if (!request.isCurrent()) return
        setConfig(body)
        await finishSignIn(body)
        if (!request.isCurrent()) return
        if (signedIn()) {
          const session = captureSession(),
            value = await workspaceRequest('', 'GET', undefined, request.signal)
          if (request.isCurrent() && session.isCurrent() && signedIn())
            setWorkspace(readWorkspace(value))
        }
      })
      .catch((cause) => {
        if (request.isCurrent()) setError(cause.message)
      })
      .finally(() => {
        if (request.isCurrent()) setConfigLoading(false)
      })
    return () => {
      unsubscribe()
      scope.invalidate()
    }
  }, [configAttempt])
  async function run(
    action: (signal: AbortSignal) => Promise<unknown>,
    message: string,
    mutation = true,
  ) {
    requests.current.invalidate()
    const request = requests.current.capture(),
      session = captureSession(),
      current = () => request.isCurrent() && session.isCurrent()
    setBusy(true)
    setError('')
    let committed = false
    try {
      await action(request.signal)
      committed = mutation
      if (!current()) return
      const value = await workspaceRequest('', 'GET', undefined, request.signal)
      if (!current()) return
      setWorkspace(readWorkspace(value))
      setNotice(message)
      setRefreshRequired(false)
    } catch (cause) {
      if (!current()) return
      setRefreshRequired(true)
      if (committed) {
        setNotice(
          `${message} Saved; refreshing the workspace failed. Reload to see the current state.`,
        )
        setError(
          'Reload before making another change. The saved mutation must not be submitted again.',
        )
      } else
        setError(
          cause instanceof Error ? cause.message : 'Workspace request failed.',
        )
    } finally {
      if (current()) setBusy(false)
    }
  }
  const eligible = journal.filter(
    (r) =>
      !['reopened', 'superseded'].includes(r.lifecycle || '') &&
      r.choice !== 'pending' &&
      (r.kind === 'one_off'
        ? oneOffs.some(
            (p) =>
              p.id === r.activityId &&
              p.date === r.date &&
              planVersion(p.plan) === r.planVersion,
          )
        : workspace?.plan && planVersion(workspace.plan) === r.planVersion),
  )
  const chosen = eligible.find((r) => r.id === selectedRecord)
  const locked = busy || refreshRequired
  return (
    <details className="card workspace-panel" id="shared-tools" tabIndex={-1}>
      <summary>Shared workspace · optional</summary>
      <p>
        Your personal plan works without an account. Shared plans and approvals
        use organization membership.
      </p>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
      {configLoading && (
        <p role="status">Loading shared connection settings…</p>
      )}
      {!configLoading && error && (
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            setError('')
            setConfigLoading(true)
            setConfigAttempt((n) => n + 1)
          }}
        >
          Retry shared connection
        </button>
      )}
      {!config?.clientId && !configLoading && !error ? (
        <p className="help-text">
          Shared workspaces become available after AWS deployment and account
          provisioning.
        </p>
      ) : config?.clientId && !workspace ? (
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            const request = requests.current.capture(),
              session = captureSession()
            signIn(config).catch((cause) => {
              if (request.isCurrent() && session.isCurrent())
                setError(cause.message)
            })
          }}
        >
          Sign in to workspace
        </button>
      ) : workspace && config ? (
        <>
          <p>
            Workspace {workspace.membership.workspaceId} ·{' '}
            {workspace.membership.role} · plan version {workspace.version}
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              type="button"
              disabled={
                locked ||
                !plan.configured ||
                !['owner', 'approver'].includes(workspace.membership.role)
              }
              onClick={() =>
                run(
                  (signal) =>
                    workspaceRequest(
                      '/plan',
                      'PUT',
                      {
                        plan,
                        version: workspace.version,
                      },
                      signal,
                    ),
                  'Shared plan updated.',
                )
              }
            >
              Save current plan to workspace
            </button>
            {workspace.plan && (
              <button
                className="button secondary"
                type="button"
                disabled={locked}
                onClick={async () => {
                  const request = requests.current.capture(),
                    session = captureSession()
                  const current = () =>
                    request.isCurrent() && session.isCurrent()
                  setBusy(true)
                  setError('')
                  try {
                    await onLoad(workspace.plan!)
                    if (current())
                      setNotice(
                        'Shared plan loaded for local review. Check the browser storage status above.',
                      )
                  } catch (cause) {
                    if (current())
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : 'The shared plan could not load locally.',
                      )
                  } finally {
                    if (current()) setBusy(false)
                  }
                }}
              >
                Use shared plan locally
              </button>
            )}
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => run(async () => {}, 'Workspace refreshed.', false)}
            >
              Reload workspace
            </button>
            <button className="text-button" type="button" onClick={signOut}>
              Sign out on this browser
            </button>
          </div>
          <label className="radio-option">
            <input
              type="checkbox"
              checked={Boolean(workspace.membership.notifications)}
              disabled={locked}
              onChange={(event) =>
                run(
                  (signal) =>
                    workspaceRequest(
                      '/notifications',
                      'PUT',
                      {
                        enabled: event.target.checked,
                      },
                      signal,
                    ),
                  'Notification preference saved.',
                )
              }
            />
            Email me when I approve a decision.{' '}
            {config.notificationConfigured
              ? ''
              : 'Delivery is not configured yet.'}
          </label>
          <SharedGroups
            groups={workspace.groups || []}
            place={place}
            disabled={
              locked ||
              !['owner', 'approver'].includes(workspace.membership.role)
            }
            onSelect={onSelectPlace}
            onSave={(groups) =>
              void run(
                (signal) =>
                  workspaceRequest(
                    '/groups',
                    'PUT',
                    { groups, version: workspace.groupVersion },
                    signal,
                  ),
                'Shared groups saved.',
              )
            }
          />
          <NotificationSettings
            key={workspace.membership.workspaceId}
            plan={plan}
            place={place}
            configured={Boolean(config.capabilities?.reviewEmail)}
          />
          {eligible.length > 0 && (
            <div className="proposal-form">
              <label>
                Choose a reviewed local record
                <select
                  value={selectedRecord}
                  disabled={locked}
                  onChange={(e) => {
                    setSelectedRecord(e.target.value)
                    setReplacement('')
                  }}
                >
                  <option value="">Select a dated record</option>
                  {eligible.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.date} · {r.activity} · {r.choice} · {r.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Replace an existing proposal for this dated activity (optional)
                <select
                  value={replacement}
                  disabled={locked || !chosen}
                  onChange={(e) => setReplacement(e.target.value)}
                >
                  <option value="">Create a proposal</option>
                  {workspace.decisions
                    .filter(
                      (r) =>
                        r.lifecycle !== 'superseded' &&
                        r.date === chosen?.date &&
                        r.activityId === chosen?.activityId &&
                        r.evidence.area === chosen?.location?.areaId,
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.activity} · {r.approval} · {r.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button secondary"
                type="button"
                disabled={locked || !chosen}
                onClick={() =>
                  run(
                    (signal) =>
                      workspaceRequest(
                        '/decisions',
                        'POST',
                        {
                          record: chosen,
                          ...(chosen?.kind === 'one_off'
                            ? {
                                plan: oneOffs.find(
                                  (p) =>
                                    p.id === chosen.activityId &&
                                    p.date === chosen.date,
                                )?.plan,
                              }
                            : {}),
                          ...(replacement
                            ? {
                                supersedes: replacement,
                                version: workspace.decisions.find(
                                  (r) => r.id === replacement,
                                )?.version,
                              }
                            : {}),
                        },
                        signal,
                      ),
                    'Selected decision submitted for approval.',
                  )
                }
              >
                Submit selected record
              </button>
            </div>
          )}
          <ul className="workspace-records">
            {workspace.decisions.map((record) => (
              <li key={record.id}>
                <strong>{record.activity}</strong> · {record.choice} ·{' '}
                {record.approval} · {record.lifecycle || 'recorded'} · version{' '}
                {record.version} · email: {record.delivery}
                {record.reopenedAt && (
                  <p>
                    Reopened {record.reopenedAt}: {record.reopenReason}
                  </p>
                )}
                {record.supersededBy && (
                  <p>Replaced by {record.supersededBy}</p>
                )}
                <p>
                  {record.date} · original {record.activityWindow.start}–
                  {record.activityWindow.end}
                  {record.proposedStart && record.proposedEnd
                    ? ` · chosen ${record.proposedStart}–${record.proposedEnd}`
                    : ''}
                </p>
                <p>
                  <strong>Reason:</strong> {record.reason}
                </p>
                <p>
                  Reviewed window:{' '}
                  {record.modelAssessment?.value ?? 'unavailable'} µg/m³ PM2.5 ·
                  user rule {record.threshold} ·{' '}
                  {record.modelAssessment?.coverage || 'unknown'} coverage.{' '}
                  Forecast retrieved{' '}
                  {record.evidence.forecastFetchedAt || 'time unavailable'} ·
                  guidance: {record.evidence.policyStatus}.
                </p>
                <p className="help-text">
                  Evidence {record.snapshotId}. Approval records your judgment;
                  it does not establish safe air or override an official order.
                </p>
                <label>
                  Follow-through
                  <select
                    value={record.followThrough || 'unconfirmed'}
                    disabled={
                      locked ||
                      record.approval !== 'approved' ||
                      ['reopened', 'superseded'].includes(
                        record.lifecycle || '',
                      )
                    }
                    onChange={(event) =>
                      run(
                        (signal) =>
                          workspaceRequest(
                            `/decisions/${record.id}/follow-through`,
                            'PUT',
                            {
                              status: event.target.value,
                              version: record.version,
                            },
                            signal,
                          ),
                        'Follow-through recorded.',
                      )
                    }
                  >
                    <option value="unconfirmed">Not confirmed</option>
                    <option value="followed">Followed</option>
                    <option value="not_followed">Not followed</option>
                  </select>
                </label>
                {record.approval === 'pending' &&
                  !['reopened', 'superseded'].includes(
                    record.lifecycle || '',
                  ) &&
                  ['owner', 'approver'].includes(workspace.membership.role) && (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={locked}
                      onClick={() =>
                        run(
                          (signal) =>
                            workspaceRequest(
                              `/decisions/${record.id}/approve`,
                              'POST',
                              { version: record.version },
                              signal,
                            ),
                          'Approval recorded.',
                        )
                      }
                    >
                      Approve decision
                    </button>
                  )}
                {!['reopened', 'superseded'].includes(record.lifecycle || '') &&
                  (record.author === workspace.membership.sub ||
                    ['owner', 'approver'].includes(
                      workspace.membership.role,
                    )) && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        void run(
                          (signal) =>
                            workspaceRequest(
                              `/decisions/${record.id}/reopen`,
                              'POST',
                              {
                                version: record.version,
                                reason: reopenReasons[record.id],
                              },
                              signal,
                            ),
                          'Proposal reopened; record and submit a newly reviewed replacement.',
                        )
                      }}
                    >
                      <label>
                        Reason for reopening
                        <input
                          required
                          maxLength={500}
                          value={reopenReasons[record.id] || ''}
                          disabled={locked}
                          onChange={(e) =>
                            setReopenReasons({
                              ...reopenReasons,
                              [record.id]: e.target.value,
                            })
                          }
                        />
                      </label>
                      <button
                        type="submit"
                        className="button secondary"
                        disabled={locked || !reopenReasons[record.id]?.trim()}
                      >
                        Reopen proposal
                      </button>
                    </form>
                  )}
              </li>
            ))}
          </ul>
          <details>
            <summary>Audit history · up to 200 recent events</summary>
            <ol>
              {workspace.audit?.map((row, index) => (
                <li key={`${row.at}-${index}`}>
                  {row.at} · {row.action} · actor {row.actor}
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : null}
    </details>
  )
}
