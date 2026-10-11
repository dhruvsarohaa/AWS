import { useEffect, useRef, useState } from 'react'
import type { Language } from '../types.ts'
import {
  onSessionEnd,
  onSessionStart,
  signedIn,
  workspaceRequest,
} from '../lib/auth.ts'
import { readR5Devices, r5CurrentIndoor } from '../lib/r5-devices.ts'
import type { R5Device, R5DevicesResponse } from '../lib/r5-devices.ts'
import './R5Devices.css'

export default function R5DevicesPanel({
  enabled,
  language,
  active = true,
}: {
  enabled: boolean
  language: Language
  active?: boolean
}) {
  const [data, setData] = useState<R5DevicesResponse | null>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(true),
    [now, setNow] = useState(Date.now),
    [online, setOnline] = useState(navigator.onLine),
    [consent, setConsent] = useState<Record<string, boolean>>({}),
    [authenticated, setAuthenticated] = useState(signedIn)
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0)
  const t = (en: string, hi: string) => (language === 'hi' ? hi : en)
  const date = (value: string) =>
    new Date(value).toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN', {
      timeZone: 'Asia/Kolkata',
    })
  const stateName = (state: string) =>
    ({
      current: t('Current', 'वर्तमान'),
      stale: t('Old reading', 'पुरानी रीडिंग'),
      unverified: t('Unverified', 'असत्यापित'),
      unavailable: t('Unavailable', 'अनुपलब्ध'),
      on: t('On', 'चालू'),
      off: t('Off', 'बंद'),
      unknown: t('Unknown actual outcome', 'वास्तविक परिणाम अज्ञात'),
      queued: t('Queued', 'कतार में'),
      dispatched: t('Claimed by gateway', 'गेटवे ने प्राप्त किया'),
      acknowledged: t('Gateway acknowledged', 'गेटवे की पुष्टि'),
      observed: t('Observed change', 'बदलाव देखा गया'),
      expired: t('Expired before dispatch', 'भेजने से पहले समाप्त'),
      suppressed: t('Suppressed', 'रोका गया'),
      rejected: t('Gateway rejected', 'गेटवे ने अस्वीकार किया'),
      reconciled: t('Owner reconciled', 'मालिक ने जाँच की'),
    })[state as 'current'] || state
  async function reload(signal: AbortSignal, current: number) {
    const result = readR5Devices(
      await workspaceRequest('/devices', 'GET', undefined, signal),
    )
    if (signal.aborted || current !== generation.current) return false
    setData(result)
    setLocked(false)
    setError('')
    setNow(Date.now())
    return true
  }
  useEffect(() => {
    const end = () => {
      generation.current++
      controller.current?.abort()
      setData(null)
      setConsent({})
      setError('')
      setMessage('')
      setLocked(true)
      setBusy(false)
      setAuthenticated(false)
    }
    const unsubscribe = onSessionEnd(end)
    const start = onSessionStart(() => setAuthenticated(true))
    const connectivity = () => {
      setOnline(navigator.onLine)
      setNow(Date.now())
    }
    window.addEventListener('online', connectivity)
    window.addEventListener('offline', connectivity)
    const tick = setInterval(() => {
      setNow(Date.now())
      if (!signedIn()) end()
    }, 15000)
    return () => {
      unsubscribe()
      start()
      clearInterval(tick)
      window.removeEventListener('online', connectivity)
      window.removeEventListener('offline', connectivity)
      end()
    }
  }, [])
  useEffect(() => {
    generation.current++
    controller.current?.abort()
    const request = new AbortController(),
      current = generation.current
    controller.current = request
    queueMicrotask(() => {
      if (request.signal.aborted || current !== generation.current) return
      setData(null)
      setLocked(true)
      setConsent({})
      setError('')
      setMessage('')
      setBusy(enabled && active && authenticated)
      if (!enabled || !active || !authenticated) return
      void reload(request.signal, current)
        .catch((e: unknown) => {
          if (!request.signal.aborted && current === generation.current)
            setError(
              e instanceof Error
                ? e.message
                : language === 'hi'
                  ? 'उपकरण डेटा अनुपलब्ध है।'
                  : 'Device evidence is unavailable.',
            )
        })
        .finally(() => {
          if (!request.signal.aborted && current === generation.current)
            setBusy(false)
        })
    })
    return () => request.abort()
  }, [enabled, active, authenticated, language])
  async function refresh() {
    controller.current?.abort()
    const request = new AbortController(),
      current = ++generation.current
    controller.current = request
    setBusy(true)
    setLocked(true)
    setConsent({})
    setMessage('')
    try {
      await reload(request.signal, current)
    } catch (e) {
      if (!request.signal.aborted && current === generation.current)
        setError(
          e instanceof Error
            ? e.message
            : t('Refresh failed.', 'रिफ्रेश असफल।'),
        )
    } finally {
      if (!request.signal.aborted && current === generation.current)
        setBusy(false)
    }
  }
  async function mutate(path: string, method: string, body: unknown) {
    if (busy || locked || !online) return
    controller.current?.abort()
    const request = new AbortController(),
      current = ++generation.current
    controller.current = request
    setBusy(true)
    setLocked(true)
    setError('')
    setMessage('')
    setConsent({})
    let committed = false
    try {
      await workspaceRequest(path, method, body, request.signal)
      if (request.signal.aborted || current !== generation.current) return
      committed = true
      setMessage(
        t(
          'Saved. Reloading device evidence…',
          'सहेजा गया। उपकरण डेटा फिर पढ़ रहे हैं…',
        ),
      )
      await reload(request.signal, current)
      if (!request.signal.aborted && current === generation.current)
        setMessage(
          t(
            'Saved. A queued or acknowledged command does not confirm equipment changed state.',
            'सहेजा गया। कतार या गेटवे पुष्टि से उपकरण का बदलाव प्रमाणित नहीं होता।',
          ),
        )
    } catch (e) {
      if (!request.signal.aborted && current === generation.current) {
        setError(
          e instanceof Error ? e.message : t('Request failed.', 'अनुरोध असफल।'),
        )
        setMessage(
          committed
            ? t(
                'Saved; refreshing failed. Controls are locked. Reload before continuing.',
                'सहेजा गया; रिफ्रेश असफल। नियंत्रण बंद हैं। जारी रखने से पहले फिर पढ़ें।',
              )
            : t(
                'The request outcome needs a reload before another change.',
                'फिर बदलाव करने से पहले अनुरोध का परिणाम फिर पढ़ें।',
              ),
        )
      }
    } finally {
      if (!request.signal.aborted && current === generation.current)
        setBusy(false)
    }
  }
  function manualCommand(device: R5Device, action: 'on' | 'off') {
    void mutate(`/devices/${device.id}/commands`, 'POST', {
      version: device.version,
      commandId: crypto.randomUUID(),
      action,
      expiresAt: new Date(now + 60000).toISOString(),
      expectedTelemetrySequence: device.telemetry?.sequence,
      operatingPolicyId: device.operatingPolicyId,
      confirmedPolicy: consent[device.id] === true,
    })
  }
  if (!enabled || !active || !authenticated) return null
  const canEdit =
    data?.membership.role === 'owner' && !locked && !busy && online
  return (
    <section className="card r5-devices" aria-labelledby="r5-devices-title">
      <h2 id="r5-devices-title" tabIndex={-1}>
        {t(
          'Private indoor evidence and equipment',
          'निजी अंदर का डेटा और उपकरण',
        )}
      </h2>
      <p>
        {t(
          'Measurements come from your validated device gateway. Indoor sensors are not regulatory reference measurements.',
          'माप आपके सत्यापित उपकरण गेटवे से आते हैं। अंदर के सेंसर नियामक संदर्भ माप नहीं हैं।',
        )}
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={busy || !online}
        onClick={() => void refresh()}
      >
        {t('Reload device evidence', 'उपकरण डेटा फिर पढ़ें')}
      </button>
      {!online && (
        <p role="status">
          {t(
            'Offline. Device changes are unavailable; retained measurements keep their original times.',
            'ऑफ़लाइन। उपकरण बदलना उपलब्ध नहीं है; सहेजे माप का मूल समय बरकरार है।',
          )}
        </p>
      )}
      {busy && <p role="status">{t('Loading…', 'लोड हो रहा है…')}</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {data && !data.devices.length && (
        <p>
          {t(
            'No device is enrolled in this workspace. Only a server-reviewed physical device can be added.',
            'इस कार्यस्थान में उपकरण दर्ज नहीं है। केवल सर्वर पर समीक्षा किया भौतिक उपकरण जोड़ा जा सकता है।',
          )}
        </p>
      )}
      {data?.devices.map((device) => {
        const fresh = r5CurrentIndoor(device, now),
          telemetry = device.telemetry,
          outdoor = device.outdoor,
          outdoorCurrent =
            outdoor?.state === 'current' &&
            Date.parse(outdoor.validAt) <= now &&
            now - Date.parse(outdoor.validAt) <= outdoor.maxAgeSeconds * 1000,
          pending = device.commands.some((c) =>
            ['queued', 'dispatched', 'acknowledged', 'unknown'].includes(
              c.status,
            ),
          ),
          cycleReady =
            device.lastCycleAt !== null &&
            device.minimumCycleSeconds !== null &&
            now - Date.parse(device.lastCycleAt) >=
              device.minimumCycleSeconds * 1000,
          usablePM = telemetry?.readings.some(
            (r) => r.pollutant === 'pm25' && r.value !== null,
          ),
          controlReady =
            canEdit &&
            fresh &&
            usablePM &&
            !pending &&
            cycleReady &&
            device.interlocksReady &&
            consent[device.id] === true
        return (
          <article key={device.id} className="r5-device">
            <h3>{device.name}</h3>
            <p>
              {device.id} · {device.source} · {device.placement.room}
            </p>
            <p>
              {t('Placement', 'स्थान')}: {device.placement.note} ·{' '}
              {t('Installed', 'स्थापित')}: {date(device.placement.installedAt)}{' '}
              IST
            </p>
            <p>
              {t('Calibration', 'अंशांकन')}: {date(device.calibration.at)} IST ·{' '}
              {device.calibration.method} · {device.calibration.reference}
            </p>
            <p>
              {t('Indoor', 'अंदर')}:{' '}
              {stateName(
                telemetry
                  ? fresh
                    ? 'current'
                    : device.evidenceState === 'unverified'
                      ? 'unverified'
                      : 'stale'
                  : 'unavailable',
              )}
              {device.revoked && (
                <> · {t('Credentials revoked', 'पहचान अनुमति रद्द')}</>
              )}
            </p>
            {device.credentialRotationAvailable &&
              data.membership.role === 'owner' && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={consent[device.id] || false}
                      onChange={(e) =>
                        setConsent((v) => ({
                          ...v,
                          [device.id]: e.target.checked,
                        }))
                      }
                    />{' '}
                    {t(
                      'The operator has provisioned and physically verified the replacement gateway credentials.',
                      'संचालक ने नए गेटवे पहचान विवरण जारी किए हैं और भौतिक जाँच की है।',
                    )}
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!canEdit || consent[device.id] !== true}
                    onClick={() =>
                      void mutate(`/devices/${device.id}/rotate`, 'POST', {
                        version: device.version,
                        confirmed: true,
                      })
                    }
                  >
                    {t(
                      'Bind the reviewed credential rotation',
                      'समीक्षा किया पहचान बदलाव जोड़ें',
                    )}
                  </button>
                </>
              )}
            {telemetry && (
              <>
                <p>
                  {t('Measured', 'मापा गया')}: {date(telemetry.measuredAt)} IST
                  · {t('Retrieved', 'प्राप्त')}: {date(telemetry.retrievedAt)}{' '}
                  IST
                </p>
                <div className="table-scroll">
                  <table>
                    <caption>
                      {t('Indoor sensor readings', 'अंदर के सेंसर माप')}
                    </caption>
                    <thead>
                      <tr>
                        <th>{t('Pollutant', 'प्रदूषक')}</th>
                        <th>µg/m³</th>
                        <th>{t('Statistic / interval', 'आँकड़ा / अवधि')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {telemetry.readings.map((r) => (
                        <tr key={r.pollutant}>
                          <th>{r.pollutant === 'pm25' ? 'PM2.5' : 'PM10'}</th>
                          <td>{r.value ?? t('Missing', 'गायब')}</td>
                          <td>
                            {r.statistic === 'instant'
                              ? t('Instant measurement', 'तात्कालिक माप')
                              : `${t('Mean', 'औसत')} · ${date(r.period!.start)} – ${date(r.period!.end)} IST`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!!telemetry.qualityFlags.length && (
                  <p>
                    {t('Quality flags', 'गुणवत्ता संकेत')}:{' '}
                    {telemetry.qualityFlags.join(', ')}
                  </p>
                )}
                <p>
                  {t('Observed equipment state', 'देखी गई उपकरण स्थिति')}:{' '}
                  {stateName(telemetry.observedState)} ·{' '}
                  {date(telemetry.observedStateAt)} IST
                </p>
              </>
            )}
            <p>
              {t('Outdoor evidence', 'बाहर का डेटा')}:{' '}
              {outdoor ? (
                <>
                  {stateName(
                    outdoorCurrent
                      ? 'current'
                      : outdoor.state === 'unverified'
                        ? 'unverified'
                        : 'stale',
                  )}{' '}
                  · {outdoor.source} ·{' '}
                  {outdoor.family === 'observation'
                    ? t('Observation', 'प्रत्यक्ष माप')
                    : t('Model forecast', 'मॉडल पूर्वानुमान')}{' '}
                  · PM2.5 {outdoor.value ?? t('Missing', 'गायब')} µg/m³ ·{' '}
                  {outdoor.statistic} · {date(outdoor.validAt)} IST ·{' '}
                  {outdoor.identity} · {outdoor.attribution}
                </>
              ) : (
                t(
                  'Unavailable; no outdoor value is fabricated.',
                  'अनुपलब्ध; बाहर का माप बनाया नहीं जाता।',
                )
              )}
            </p>
            {device.outdoorRefreshFailed && (
              <p role="status">
                {t(
                  'Outdoor retrieval failed; indoor readings retain their own source and times.',
                  'बाहर का डेटा प्राप्त नहीं हुआ; अंदर के माप का स्रोत और समय अलग बरकरार है।',
                )}
              </p>
            )}
            {device.controlsAvailable && (
              <div className="r5-control">
                <p>
                  {t('Operating policy', 'संचालन नीति')}:{' '}
                  {device.operatingPolicyId} ·{' '}
                  {t('Disconnection policy', 'कनेक्शन टूटने की नीति')}:{' '}
                  {device.disconnectionPolicy}
                </p>
                <p>
                  {t('Required interlocks', 'आवश्यक अवरोध शर्तें')}:{' '}
                  {device.interlocksReady
                    ? t('Reported ready', 'तैयार बताई गईं')
                    : t(
                        'Missing, expired or blocked',
                        'गायब, समाप्त या अवरुद्ध',
                      )}{' '}
                  · {t('Minimum cycle', 'न्यूनतम चक्र')}:{' '}
                  {device.minimumCycleSeconds} s
                </p>
                {telemetry?.interlocks.map((i) => (
                  <p key={i.id}>
                    {i.id}:{' '}
                    {i.satisfied
                      ? t('Satisfied', 'पूरी')
                      : t('Blocked', 'अवरुद्ध')}{' '}
                    · {t('Valid until', 'तक वैध')}: {date(i.validUntil)} IST
                  </p>
                ))}
                <p>
                  {t('Manual override', 'मैनुअल नियंत्रण प्राथमिकता')}:{' '}
                  {device.manualOverride.active
                    ? t(
                        'Active; new automatic decisions are paused',
                        'सक्रिय; नए स्वचालित निर्णय रुके हैं',
                      )
                    : t('Released', 'हटाई गई')}
                </p>
                {data.membership.role === 'owner' && (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        disabled={!canEdit}
                        checked={consent[device.id] || false}
                        onChange={(e) =>
                          setConsent((v) => ({
                            ...v,
                            [device.id]: e.target.checked,
                          }))
                        }
                      />{' '}
                      {t(
                        'I have checked the actual equipment and its operating policy for this change.',
                        'मैंने इस बदलाव के लिए वास्तविक उपकरण और संचालन नीति जाँची है।',
                      )}
                    </label>
                    <div className="r5-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={
                          !controlReady || telemetry?.observedState !== 'off'
                        }
                        onClick={() => manualCommand(device, 'on')}
                      >
                        {t('Request on', 'चालू करने का अनुरोध')}
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={
                          !controlReady || telemetry?.observedState !== 'on'
                        }
                        onClick={() => manualCommand(device, 'off')}
                      >
                        {t('Request off', 'बंद करने का अनुरोध')}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        disabled={!canEdit || consent[device.id] !== true}
                        onClick={() =>
                          void mutate(`/devices/${device.id}/override`, 'PUT', {
                            version: device.version,
                            active: !device.manualOverride.active,
                            explicitConsent: true,
                          })
                        }
                      >
                        {device.manualOverride.active
                          ? t(
                              'Release manual override',
                              'मैनुअल प्राथमिकता हटाएँ',
                            )
                          : t(
                              'Pause automatic decisions',
                              'स्वचालित निर्णय रोकें',
                            )}
                      </button>
                    </div>
                    {!fresh && (
                      <p>
                        {t(
                          'Controls require fresh verified indoor measurements and observed state.',
                          'नियंत्रण के लिए ताज़ा सत्यापित अंदर के माप और देखी गई स्थिति चाहिए।',
                        )}
                      </p>
                    )}
                    {pending && (
                      <p>
                        {t(
                          'An earlier command is pending or uncertain. Wait for observed confirmation, or physically check and reconcile an expired command.',
                          'पहले अनुरोध का परिणाम लंबित या अज्ञात है। देखी गई पुष्टि की प्रतीक्षा करें, या समाप्त अनुरोध का भौतिक परीक्षण करें।',
                        )}
                      </p>
                    )}
                    {!cycleReady && (
                      <p>
                        {t(
                          'The minimum cycle interval has not elapsed or is unknown.',
                          'न्यूनतम चक्र अवधि पूरी नहीं हुई या अज्ञात है।',
                        )}
                      </p>
                    )}
                    {device.commands
                      .filter((c) => c.status === 'unknown')
                      .map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="text-button"
                          disabled={
                            !canEdit || !fresh || consent[device.id] !== true
                          }
                          onClick={() =>
                            void mutate(
                              `/devices/${device.id}/reconcile`,
                              'POST',
                              {
                                version: device.version,
                                commandId: c.id,
                                confirmedPhysicalCheck: true,
                              },
                            )
                          }
                        >
                          {t(
                            'Record physical reconciliation',
                            'भौतिक परीक्षण दर्ज करें',
                          )}{' '}
                          · {c.id}
                        </button>
                      ))}
                    <button
                      type="button"
                      className="text-button"
                      disabled={!canEdit || consent[device.id] !== true}
                      onClick={() =>
                        void mutate(`/devices/${device.id}/revoke`, 'POST', {
                          version: device.version,
                          confirmed: true,
                        })
                      }
                    >
                      {t(
                        'Revoke this gateway device',
                        'इस गेटवे उपकरण की अनुमति रद्द करें',
                      )}
                    </button>
                  </>
                )}
                {device.automationAvailable &&
                  data.membership.role === 'owner' && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        const fields = new FormData(e.currentTarget)
                        void mutate(`/devices/${device.id}/policy`, 'PUT', {
                          version: device.version,
                          policyId: crypto.randomUUID(),
                          enabled: fields.get('enabled') === 'on',
                          startThreshold: Number(fields.get('start')),
                          stopThreshold: Number(fields.get('stop')),
                          minimumCycleSeconds: Number(fields.get('cycle')),
                          explicitConsent: fields.get('consent') === 'on',
                        })
                      }}
                    >
                      <fieldset disabled={!canEdit}>
                        <legend>
                          {t(
                            'Validated purifier automation',
                            'सत्यापित शुद्धक स्वचालन',
                          )}
                        </legend>
                        <label>
                          <input
                            name="enabled"
                            type="checkbox"
                            defaultChecked={device.policy?.enabled || false}
                          />{' '}
                          {t('Enable this policy', 'यह नीति सक्षम करें')}
                        </label>
                        <label>
                          {t('Start at PM2.5 µg/m³', 'इस PM2.5 µg/m³ पर शुरू')}
                          <input
                            name="start"
                            type="number"
                            required
                            min="1"
                            max="1000"
                            defaultValue={device.policy?.startThreshold || 50}
                          />
                        </label>
                        <label>
                          {t('Stop at PM2.5 µg/m³', 'इस PM2.5 µg/m³ पर बंद')}
                          <input
                            name="stop"
                            type="number"
                            required
                            min="0"
                            max="999"
                            defaultValue={device.policy?.stopThreshold ?? 25}
                          />
                        </label>
                        <label>
                          {t('Minimum cycle seconds', 'न्यूनतम चक्र सेकंड')}
                          <input
                            name="cycle"
                            type="number"
                            required
                            min={device.minimumCycleSeconds || 60}
                            max="3600"
                            defaultValue={
                              device.policy?.minimumCycleSeconds ||
                              device.minimumCycleSeconds ||
                              60
                            }
                          />
                        </label>
                        <label>
                          <input name="consent" type="checkbox" required />{' '}
                          {t(
                            'I consent to this validated operating policy. Manual override remains separate.',
                            'मैं इस सत्यापित संचालन नीति से सहमत हूँ। मैनुअल प्राथमिकता अलग रहती है।',
                          )}
                        </label>
                        <button type="submit" className="button secondary">
                          {t('Save automation policy', 'स्वचालन नीति सहेजें')}
                        </button>
                      </fieldset>
                    </form>
                  )}
              </div>
            )}
            {!!device.commands.length && (
              <div className="table-scroll">
                <table>
                  <caption>
                    {t(
                      'Recent commands; requests and actual observations are separate',
                      'हाल के अनुरोध; अनुरोध और वास्तविक अवलोकन अलग हैं',
                    )}
                  </caption>
                  <thead>
                    <tr>
                      <th>{t('Request', 'अनुरोध')}</th>
                      <th>{t('Outcome', 'परिणाम')}</th>
                      <th>{t('Expiry · IST', 'समाप्ति · IST')}</th>
                      <th>{t('Observed · IST', 'अवलोकन · IST')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {device.commands
                      .slice()
                      .reverse()
                      .map((c) => (
                        <tr key={c.id}>
                          <th>
                            {stateName(c.action)} · {c.id}
                          </th>
                          <td>{stateName(c.status)}</td>
                          <td>{date(c.expiresAt)}</td>
                          <td>
                            {c.observedAt
                              ? date(c.observedAt)
                              : t('Not confirmed', 'पुष्टि नहीं')}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        )
      })}
      {data && data.membership.role === 'owner' && !!data.profiles.length && (
        <details>
          <summary>
            {t(
              'Enroll a reviewed physical device',
              'समीक्षा किया भौतिक उपकरण दर्ज करें',
            )}
          </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const fields = new FormData(e.currentTarget),
                chosen = String(fields.get('device')).split(':'),
                installed = new Date(String(fields.get('installed'))),
                calibrated = new Date(String(fields.get('calibrated')))
              if (
                chosen.length !== 2 ||
                !Number.isFinite(installed.getTime()) ||
                !Number.isFinite(calibrated.getTime()) ||
                installed.getTime() > now ||
                calibrated.getTime() > now
              ) {
                setError(
                  t(
                    'Choose a reviewed device and valid installation/calibration times in the past.',
                    'समीक्षा किया उपकरण और बीते समय के मान्य स्थापना/अंशांकन समय चुनें।',
                  ),
                )
                return
              }
              void mutate('/devices', 'POST', {
                version: data.registryVersion,
                profileId: chosen[0],
                id: chosen[1],
                name: fields.get('name'),
                placement: {
                  room: fields.get('room'),
                  note: fields.get('placement'),
                  installedAt: installed.toISOString(),
                },
                calibration: {
                  at: calibrated.toISOString(),
                  method: fields.get('method'),
                  reference: fields.get('reference'),
                },
              })
            }}
          >
            <fieldset disabled={!canEdit}>
              <legend>
                {t(
                  'Placement and calibration record',
                  'स्थान और अंशांकन विवरण',
                )}
              </legend>
              <label>
                {t('Validated device', 'सत्यापित उपकरण')}
                <select name="device" required>
                  {data.profiles.flatMap((p) =>
                    p.deviceIds
                      .filter((id) => !data.devices.some((d) => d.id === id))
                      .map((id) => (
                        <option key={`${p.id}:${id}`} value={`${p.id}:${id}`}>
                          {p.name} · {id}
                        </option>
                      )),
                  )}
                </select>
              </label>
              {[
                ['name', t('Display name', 'प्रदर्शित नाम'), 80],
                ['room', t('Room / site', 'कमरा / स्थल'), 80],
                [
                  'placement',
                  t('Placement limitations', 'स्थान की सीमाएँ'),
                  300,
                ],
                ['method', t('Calibration method', 'अंशांकन विधि'), 120],
                [
                  'reference',
                  t('Calibration reference', 'अंशांकन संदर्भ'),
                  120,
                ],
              ].map(([name, label, max]) => (
                <label key={String(name)}>
                  {label}
                  <input
                    name={String(name)}
                    type="text"
                    required
                    maxLength={Number(max)}
                  />
                </label>
              ))}
              <label>
                {t(
                  'Installed time · your device timezone',
                  'स्थापना समय · आपके कंप्यूटर का समय क्षेत्र',
                )}
                <input name="installed" type="datetime-local" required />
              </label>
              <label>
                {t(
                  'Calibration time · your device timezone',
                  'अंशांकन समय · आपके कंप्यूटर का समय क्षेत्र',
                )}
                <input name="calibrated" type="datetime-local" required />
              </label>
              <button type="submit" className="button secondary">
                {t('Enroll device', 'उपकरण दर्ज करें')}
              </button>
            </fieldset>
          </form>
        </details>
      )}
    </section>
  )
}
