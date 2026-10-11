import { useEffect, useRef, useState } from 'react'
import './R4Journey.css'
import type { Language } from '../types.ts'
import { say } from '../lib/labels.ts'
import {
  addJourney,
  appendForegroundPoint,
  exportJourneyGpx,
  JOURNEY_LIMITS,
  newForegroundJourney,
  parseLocalGpx,
  summarizeJourney,
} from '../lib/r4-journeys.ts'
import type { Journey, JourneyLibrary } from '../lib/r4-journeys.ts'
import {
  clearLocalJourneys,
  JOURNEY_CHANGE_EVENT,
  JOURNEY_CLEAR_EVENT,
  journeyStorageEpoch,
  loadJourneyLibrary,
  readOriginalJourneyBytes,
  saveJourneyLibrary,
} from '../lib/r4-journey-store.ts'

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function R4JourneyPanel({ language }: { language: Language }) {
  const t = (en: string, hi: string) => say(language, en, hi)
  const [library, setLibrary] = useState<JourneyLibrary | null>(null),
    [draft, setDraft] = useState<Journey | null>(null)
  const [name, setName] = useState(''),
    [consent, setConsent] = useState(false),
    [paste, setPaste] = useState('')
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false)
  const [reveal, setReveal] = useState<string | null>(null),
    [confirmClear, setConfirmClear] = useState(false)
  const [confirmReload, setConfirmReload] = useState(false)
  const libraryRef = useRef<JourneyLibrary | null>(null),
    draftRef = useRef<Journey | null>(null),
    watcher = useRef<number | null>(null)
  const mounted = useRef(false),
    generation = useRef(0),
    epochRef = useRef(journeyStorageEpoch()),
    queue = useRef<Promise<void>>(Promise.resolve())
  const busyRef = useRef(false)
  const updateBusy = (value: boolean) => {
    busyRef.current = value
    if (mounted.current) setBusy(value)
  }
  const updateDraft = (next: Journey | null) => {
    draftRef.current = next
    if (mounted.current) setDraft(next)
  }
  const stopWatch = () => {
    generation.current++
    if (watcher.current !== null)
      navigator.geolocation.clearWatch(watcher.current)
    watcher.current = null
    if (mounted.current) setRecording(false)
  }
  const persist = (journey: Journey): Promise<void> => {
    const epoch = epochRef.current
    const work = queue.current
      .catch(() => {})
      .then(async () => {
        const current = libraryRef.current
        if (!current)
          throw new Error(
            t(
              'Storage is unavailable; export the unsaved draft.',
              'संग्रह उपलब्ध नहीं; असहेजा ड्राफ़्ट निर्यात करें।',
            ),
          )
        const next = await saveJourneyLibrary(
          addJourney(current, journey),
          current.revision,
          epoch,
        )
        if (epoch !== journeyStorageEpoch())
          throw new Error('Journey data was cleared; reload before saving.')
        libraryRef.current = next
        if (mounted.current && epoch === journeyStorageEpoch()) {
          setLibrary(next)
          setMessage(t('Saved on this device.', 'इस डिवाइस पर सहेजा गया।'))
        }
      })
    queue.current = work
    return work
  }
  const interrupt = (reason: string, completed = false) => {
    const active = watcher.current !== null
    stopWatch()
    const current = draftRef.current
    if (!active || !current || current.status !== 'recording') return
    const next: Journey = {
      ...current,
      status: completed ? 'completed' : 'interrupted',
      interruption: completed ? null : reason,
    }
    updateDraft(next)
    void persist(next).catch((problem: unknown) => {
      if (mounted.current)
        setError(
          problem instanceof Error
            ? problem.message
            : t(
                'Save failed; export your draft.',
                'सहेजना असफल; ड्राफ़्ट निर्यात करें।',
              ),
        )
    })
  }
  const reload = async (discard = false) => {
    const currentDraft = draftRef.current
    if (
      !discard &&
      currentDraft &&
      !libraryRef.current?.journeys.some(
        (saved) => JSON.stringify(saved) === JSON.stringify(currentDraft),
      )
    ) {
      setConfirmReload(true)
      return
    }
    setConfirmReload(false)
    const loadingEpoch = journeyStorageEpoch(),
      loadingGeneration = ++generation.current
    updateBusy(true)
    setError('')
    try {
      const next = await loadJourneyLibrary()
      if (
        !mounted.current ||
        loadingEpoch !== journeyStorageEpoch() ||
        loadingGeneration !== generation.current
      )
        return
      libraryRef.current = next
      epochRef.current = journeyStorageEpoch()
      setLibrary(next)
      const unfinished = next.journeys.find(
        (journey) => journey.status === 'recording',
      )
      if (unfinished)
        updateDraft({
          ...unfinished,
          status: 'interrupted',
          interruption:
            'Previous foreground recording ended without a confirmed stop.',
        })
      else updateDraft(null)
      setMessage(
        t(
          'Saved journeys loaded. An interrupted journey never resumes tracking automatically.',
          'सहेजी यात्राएं लोड हुईं। रुकी यात्रा अपने-आप ट्रैक नहीं होती।',
        ),
      )
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : 'Journey load failed.',
      )
      libraryRef.current = null
      setLibrary(null)
    } finally {
      updateBusy(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    void reload()
    const visibility = () => {
      if (document.visibilityState !== 'visible')
        interrupt('Page left the foreground; the unobserved interval is a gap.')
    }
    const pagehide = () =>
      interrupt('Page closed or suspended; the final save may need recovery.')
    const clear = () => {
      stopWatch()
      epochRef.current = journeyStorageEpoch()
      updateDraft(null)
      setLibrary(null)
      libraryRef.current = null
      setConsent(false)
      setPaste('')
      setReveal(null)
      setMessage(
        t(
          'Local journeys were cleared. Reload before starting again.',
          'स्थानीय यात्राएं हटाई गईं। फिर शुरू करने से पहले पुनः लोड करें।',
        ),
      )
    }
    const changed = () => {
      if (libraryRef.current)
        setMessage(
          t(
            'Journey storage changed. Reload before editing from another tab.',
            'यात्रा संग्रह बदला है। दूसरे टैब से संपादन से पहले पुनः लोड करें।',
          ),
        )
    }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', pagehide)
    window.addEventListener(JOURNEY_CLEAR_EVENT, clear)
    window.addEventListener(JOURNEY_CHANGE_EVENT, changed)
    return () => {
      interrupt('Journey panel closed; foreground recording was interrupted.')
      mounted.current = false
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', pagehide)
      window.removeEventListener(JOURNEY_CLEAR_EVENT, clear)
      window.removeEventListener(JOURNEY_CHANGE_EVENT, changed)
    }
    // The mounted controller deliberately keeps one tracker and its own storage references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const start = async () => {
    if (
      !consent ||
      watcher.current !== null ||
      busyRef.current ||
      !libraryRef.current
    )
      return
    if (!navigator.geolocation || !window.isSecureContext) {
      setError(
        t(
          'GPS needs a supported browser on HTTPS or localhost.',
          'GPS के लिए समर्थित ब्राउज़र और HTTPS या localhost चाहिए।',
        ),
      )
      return
    }
    if (document.visibilityState !== 'visible') return
    updateBusy(true)
    setError('')
    setMessage('')
    const journey = newForegroundJourney(name),
      startGeneration = ++generation.current
    updateDraft(journey)
    try {
      await persist(journey)
      if (
        !mounted.current ||
        generation.current !== startGeneration ||
        epochRef.current !== journeyStorageEpoch()
      )
        return
      const token = startGeneration
      watcher.current = navigator.geolocation.watchPosition(
        (position) => {
          if (
            generation.current !== token ||
            epochRef.current !== journeyStorageEpoch() ||
            document.visibilityState !== 'visible'
          )
            return
          const current = draftRef.current
          if (!current || current.status !== 'recording') return
          const previous = current.points.at(-1)
          // Browser fixes can repeat timestamps. Sampling does not invent intermediate positions.
          if (
            previous?.time &&
            position.timestamp - Date.parse(previous.time) < 5000
          )
            return
          try {
            const next = appendForegroundPoint(current, {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyMeters: position.coords.accuracy,
              time: new Date(position.timestamp).toISOString(),
            })
            updateDraft(next)
            void persist(next).catch((problem: unknown) => {
              interrupt(
                'Storage conflict or save failure; no more positions were recorded.',
              )
              if (mounted.current)
                setError(
                  problem instanceof Error
                    ? problem.message
                    : 'Journey save failed.',
                )
            })
          } catch (problem) {
            interrupt('GPS fix unavailable or journey limit reached.')
            setError(
              problem instanceof Error
                ? problem.message
                : 'GPS fix is invalid.',
            )
          }
        },
        () => {
          if (generation.current === token) {
            interrupt(
              'GPS permission, reception or device location became unavailable.',
            )
            setError(
              t(
                'GPS stopped. Saved positions remain; the missing interval is not filled.',
                'GPS रुका। सहेजे स्थान बने हैं; गायब समय नहीं भरा जाता।',
              ),
            )
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      )
      setRecording(true)
      setMessage(
        t(
          'Recording while this page stays visible. Stop before leaving this panel.',
          'यह पेज दिखाई देने तक रिकॉर्डिंग चालू है। पैनल छोड़ने से पहले रोकें।',
        ),
      )
    } catch (problem) {
      updateDraft({
        ...journey,
        status: 'interrupted',
        interruption:
          'Recording did not start because the initial save failed.',
      })
      setError(
        problem instanceof Error ? problem.message : 'Journey could not start.',
      )
    } finally {
      updateBusy(false)
    }
  }
  const preview = (xml: string, fileName?: string) => {
    if (watcher.current !== null || busyRef.current) return
    setError('')
    setMessage('')
    try {
      updateDraft(
        parseLocalGpx(
          xml,
          name.trim() || fileName || t('Imported journey', 'आयातित यात्रा'),
        ),
      )
      setMessage(
        t(
          'Preview only. Save explicitly to keep this local track.',
          'केवल पूर्वावलोकन। स्थानीय यात्रा रखने के लिए सहेजें।',
        ),
      )
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : 'GPX import failed.',
      )
    }
  }
  const saveDraft = async () => {
    if (!draft || watcher.current !== null || busyRef.current) return
    generation.current++
    updateBusy(true)
    setError('')
    try {
      await persist(draft)
      updateDraft(null)
      setPaste('')
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : 'Journey save failed.',
      )
    } finally {
      updateBusy(false)
    }
  }
  const deleteJourney = async (id: string) => {
    if (watcher.current !== null || busyRef.current || !libraryRef.current)
      return
    generation.current++
    const deletingEpoch = epochRef.current
    updateBusy(true)
    setError('')
    try {
      await queue.current.catch(() => {})
      const current = libraryRef.current
      if (!current) return
      const next = await saveJourneyLibrary(
        {
          ...current,
          journeys: current.journeys.filter((journey) => journey.id !== id),
        },
        current.revision,
        deletingEpoch,
      )
      if (deletingEpoch !== journeyStorageEpoch()) return
      libraryRef.current = next
      setLibrary(next)
      if (draftRef.current?.id === id) updateDraft(null)
      setReveal(null)
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : 'Journey deletion failed.',
      )
    } finally {
      updateBusy(false)
    }
  }
  const summary = draft ? summarizeJourney(draft) : null
  return (
    <section className="card r4-journeys" aria-labelledby="r4-journeys-title">
      <p className="eyebrow">
        {t('PRIVATE ON THIS DEVICE', 'इस डिवाइस पर निजी')}
      </p>
      <h2 id="r4-journeys-title" tabIndex={-1}>
        {t('Local journeys', 'स्थानीय यात्राएं')}
      </h2>
      <p>
        {t(
          'Record a foreground journey or import a GPX 1.1 track. Exact positions stay in this browser; no route is uploaded. This is a travel record. No compatible historical pollution feed is connected, so no exposure estimate is calculated.',
          'दिखाई देने वाले पेज पर यात्रा रिकॉर्ड करें या GPX 1.1 आयात करें। सटीक स्थान इसी ब्राउज़र में रहते हैं; यात्रा अपलोड नहीं होती। यह यात्रा रिकॉर्ड है। संगत पुराना प्रदूषण डेटा जुड़ा नहीं है, इसलिए एक्सपोज़र अनुमान नहीं बनता।',
        )}
      </p>
      <p className="help-text">
        {t(
          'Moving to another screen, hiding the tab, permission loss or storage failure stops recording. Browser suspension may end the final save; the last persisted points can be recovered. A new recording requires Start again.',
          'दूसरी स्क्रीन, छिपा टैब, अनुमति बंद या सहेजना असफल होने पर रिकॉर्डिंग रुकती है। ब्राउज़र रुकने पर आखिरी सहेजना अधूरा हो सकता है; आखिरी सहेजे स्थान मिल सकते हैं। नई रिकॉर्डिंग के लिए फिर शुरू करें।',
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <label htmlFor="r4-journey-name">
        {t('Journey name (optional)', 'यात्रा नाम (वैकल्पिक)')}
      </label>
      <input
        id="r4-journey-name"
        value={name}
        maxLength={80}
        disabled={recording || busy}
        onChange={(event) => setName(event.target.value)}
      />
      <label className="check-label">
        <input
          type="checkbox"
          checked={consent}
          disabled={recording || busy}
          onChange={(event) => setConsent(event.target.checked)}
        />
        {t(
          'I agree to record and save my exact GPS positions on this device while this page is visible.',
          'पेज दिखने तक अपने सटीक GPS स्थान इस डिवाइस पर रिकॉर्ड और सहेजने की सहमति देता/देती हूँ।',
        )}
      </label>
      <div className="button-row">
        <button
          type="button"
          className="button"
          disabled={!consent || !library || recording || busy}
          onClick={() => void start()}
        >
          {t('Start foreground recording', 'दिखते पेज पर रिकॉर्डिंग शुरू करें')}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={!recording}
          onClick={() => interrupt('', true)}
        >
          {t('Stop and save', 'रोकें और सहेजें')}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={recording || busy}
          onClick={() => void reload()}
        >
          {t('Reload saved journeys', 'सहेजी यात्राएं पुनः लोड करें')}
        </button>
      </div>
      <label htmlFor="r4-gpx-file">
        {t(
          'Choose a local GPX track (up to 1 MB)',
          'स्थानीय GPX यात्रा चुनें (1 MB तक)',
        )}
      </label>
      <input
        id="r4-gpx-file"
        type="file"
        accept=".gpx,application/gpx+xml"
        disabled={recording || busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          if (watcher.current !== null || busyRef.current) return
          if (file.size > JOURNEY_LIMITS.bytes) {
            setError(t('File exceeds 1 MB.', 'फ़ाइल 1 MB से बड़ी है।'))
            return
          }
          const importEpoch = journeyStorageEpoch(),
            importGeneration = ++generation.current
          const currentImport = () =>
            mounted.current &&
            importEpoch === journeyStorageEpoch() &&
            importGeneration === generation.current &&
            watcher.current === null &&
            !busyRef.current
          void file
            .text()
            .then((xml) => {
              if (currentImport())
                preview(xml, file.name.replace(/\.gpx$/i, ''))
            })
            .catch(() => {
              if (currentImport())
                setError(
                  t('File could not be read.', 'फ़ाइल पढ़ी नहीं जा सकी।'),
                )
            })
        }}
      />
      <details>
        <summary>
          {t(
            'Or paste GPX text for a local preview',
            'या स्थानीय पूर्वावलोकन के लिए GPX लिखें',
          )}
        </summary>
        <label htmlFor="r4-gpx-text">GPX 1.1</label>
        <textarea
          id="r4-gpx-text"
          value={paste}
          maxLength={JOURNEY_LIMITS.bytes}
          disabled={recording || busy}
          onChange={(event) => setPaste(event.target.value)}
        />
        <button
          className="button secondary"
          type="button"
          disabled={!paste.trim() || recording || busy}
          onClick={() => {
            generation.current++
            preview(paste)
          }}
        >
          {t('Preview local GPX', 'स्थानीय GPX पूर्वावलोकन')}
        </button>
      </details>
      <p className="help-text">
        {t(
          'Bounds: 10 saved journeys; 10,000 points per journey; 50,000 points overall; 24 hours per dated track; imported dates within 366 days. Untimed points remain untimed. Gaps longer than two minutes are not connected.',
          'सीमाएं: 10 सहेजी यात्राएं; हर यात्रा में 10,000 स्थान; कुल 50,000 स्थान; दिनांकित यात्रा 24 घंटे तक; आयात की तिथियां पिछले 366 दिनों में। बिना समय वाले स्थानों को समय नहीं दिया जाता। दो मिनट से बड़े अंतराल नहीं जोड़े जाते।',
        )}
      </p>
      {draft && summary && (
        <div className="notice">
          <h3>
            {t('Current draft / recovery', 'मौजूदा ड्राफ़्ट / पुनर्प्राप्ति')} ·{' '}
            {draft.name}
          </h3>
          <p>
            {draft.status} · {summary.pointCount} {t('points', 'स्थान')} ·{' '}
            {(summary.metres / 1000).toFixed(2)} km ·{' '}
            {(summary.observedSeconds / 60).toFixed(1)}{' '}
            {t('recorded minutes', 'रिकॉर्ड मिनट')} · {summary.gaps}{' '}
            {t('gaps', 'अंतराल')} · {summary.missingTimePoints}{' '}
            {t('untimed points', 'बिना समय स्थान')}
          </p>
          {draft.interruption && <p>{draft.interruption}</p>}
          <div className="button-row">
            <button
              className="button"
              type="button"
              disabled={recording || busy || !library}
              onClick={() => void saveDraft()}
            >
              {t('Save local draft', 'स्थानीय ड्राफ़्ट सहेजें')}
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() =>
                download(
                  exportJourneyGpx(draft),
                  'airday-local-journey.gpx',
                  'application/gpx+xml',
                )
              }
            >
              {t(
                'Export draft with exact positions',
                'सटीक स्थान सहित ड्राफ़्ट निर्यात',
              )}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={recording || busy}
              onClick={() => updateDraft(null)}
            >
              {t('Discard draft', 'ड्राफ़्ट हटाएं')}
            </button>
          </div>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <caption>
            {t(
              'Saved journeys · no pollution ranking',
              'सहेजी यात्राएं · प्रदूषण क्रम नहीं',
            )}
          </caption>
          <thead>
            <tr>
              <th>{t('Journey', 'यात्रा')}</th>
              <th>{t('Source / state', 'स्रोत / स्थिति')}</th>
              <th>{t('Observed distance / time', 'रिकॉर्ड दूरी / समय')}</th>
              <th>{t('Gaps', 'अंतराल')}</th>
              <th>{t('Actions', 'कार्य')}</th>
            </tr>
          </thead>
          <tbody>
            {library?.journeys.map((journey) => {
              const stats = summarizeJourney(journey)
              return (
                <tr key={journey.id}>
                  <th>{journey.name}</th>
                  <td>
                    {journey.source === 'gpx_import'
                      ? t('Local GPX import', 'स्थानीय GPX आयात')
                      : t('Foreground GPS', 'दिखते पेज का GPS')}{' '}
                    · {journey.status}
                  </td>
                  <td>
                    {(stats.metres / 1000).toFixed(2)} km ·{' '}
                    {(stats.observedSeconds / 60).toFixed(1)} min ·{' '}
                    {stats.pointCount} {t('points', 'स्थान')}
                  </td>
                  <td>
                    {stats.gaps} · {stats.missingTimePoints}{' '}
                    {t('untimed', 'बिना समय')}
                  </td>
                  <td>
                    <button
                      className="text-button"
                      type="button"
                      disabled={recording || busy}
                      onClick={() =>
                        setReveal(reveal === journey.id ? null : journey.id)
                      }
                    >
                      {t('Details and export', 'विवरण और निर्यात')}
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      disabled={recording || busy}
                      onClick={() => void deleteJourney(journey.id)}
                    >
                      {t('Delete', 'हटाएं')}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {library && !library.journeys.length && (
        <p>
          {t('No local journeys saved.', 'कोई स्थानीय यात्रा सहेजी नहीं गई।')}
        </p>
      )}
      {reveal &&
        library?.journeys
          .filter((journey) => journey.id === reveal)
          .map((journey) => (
            <div key={journey.id}>
              <h3>{journey.name}</h3>
              <p>
                {t(
                  'UTC point times are preserved. Accuracy is reported by the device; imported GPX does not establish positional accuracy. Exported files include exact positions and are separate from your planning backup.',
                  'UTC समय सुरक्षित रहते हैं। सटीकता डिवाइस बताता है; आयातित GPX सटीकता का प्रमाण नहीं है। निर्यात में सटीक स्थान होते हैं और यह योजना बैकअप से अलग है।',
                )}
              </p>
              <button
                className="button secondary"
                type="button"
                onClick={() =>
                  download(
                    exportJourneyGpx(journey),
                    'airday-local-journey.gpx',
                    'application/gpx+xml',
                  )
                }
              >
                {t(
                  'Export GPX with exact positions',
                  'सटीक स्थान सहित GPX निर्यात',
                )}
              </button>
              <div className="table-scroll">
                <table>
                  <caption>
                    {t(
                      'First 100 saved points (export includes all points)',
                      'पहले 100 स्थान (निर्यात में सभी स्थान)',
                    )}
                  </caption>
                  <thead>
                    <tr>
                      <th>UTC</th>
                      <th>{t('Latitude', 'अक्षांश')}</th>
                      <th>{t('Longitude', 'देशांतर')}</th>
                      <th>{t('Accuracy m', 'सटीकता मी')}</th>
                      <th>{t('Segment', 'खंड')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journey.points.slice(0, 100).map((point, index) => (
                      <tr key={index}>
                        <th>
                          {point.time ?? t('Time missing', 'समय अनुपलब्ध')}
                        </th>
                        <td>{point.latitude}</td>
                        <td>{point.longitude}</td>
                        <td>{point.accuracyMeters ?? '—'}</td>
                        <td>{point.segment + 1}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
      <div className="button-row">
        <button
          className="button secondary"
          type="button"
          disabled={recording || busy}
          onClick={() =>
            void readOriginalJourneyBytes()
              .then((bytes) =>
                download(
                  bytes,
                  'airday-journeys-recovery.json',
                  'application/json',
                ),
              )
              .catch((problem: unknown) =>
                setError(
                  problem instanceof Error
                    ? problem.message
                    : 'Recovery export failed.',
                ),
              )
          }
        >
          {t(
            'Export original journey storage for recovery',
            'पुनर्प्राप्ति के लिए मूल यात्रा संग्रह निर्यात',
          )}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={recording || busy}
          onClick={() => setConfirmClear(true)}
        >
          {t('Clear all local journeys', 'सभी स्थानीय यात्राएं हटाएं')}
        </button>
      </div>
      {confirmReload && (
        <div
          role="group"
          aria-label={t(
            'Confirm draft replacement',
            'ड्राफ़्ट बदलने की पुष्टि',
          )}
        >
          <p>
            {t(
              'Reload replaces the unsaved draft. Export the draft above first if you want to keep it.',
              'पुनः लोड करने पर असहेजा ड्राफ़्ट बदल जाएगा। उसे रखना है तो पहले ऊपर से निर्यात करें।',
            )}
          </p>
          <button
            className="button secondary"
            type="button"
            disabled={busy || recording}
            onClick={() => void reload(true)}
          >
            {t('Replace draft and reload', 'ड्राफ़्ट बदलकर पुनः लोड करें')}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => setConfirmReload(false)}
          >
            {t('Keep draft', 'ड्राफ़्ट रखें')}
          </button>
        </div>
      )}
      {confirmClear && (
        <div
          role="group"
          aria-label={t(
            'Confirm local journey deletion',
            'स्थानीय यात्रा हटाने की पुष्टि',
          )}
        >
          <p>
            {t(
              'This removes all exact journey positions from this browser. Export first if you want a copy.',
              'यह इस ब्राउज़र से यात्रा के सभी सटीक स्थान हटाता है। प्रतिलिपि चाहिए तो पहले निर्यात करें।',
            )}
          </p>
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => {
              if (busyRef.current || watcher.current !== null) return
              updateBusy(true)
              void clearLocalJourneys()
                .then(() => {
                  setConfirmClear(false)
                  return reload(true)
                })
                .catch((problem: unknown) =>
                  setError(
                    problem instanceof Error
                      ? problem.message
                      : 'Journey clear failed.',
                  ),
                )
                .finally(() => updateBusy(false))
            }}
          >
            {t('Confirm deletion', 'हटाने की पुष्टि')}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => setConfirmClear(false)}
          >
            {t('Cancel', 'रद्द करें')}
          </button>
        </div>
      )}
    </section>
  )
}
