import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Language, LocalState } from '../types.ts'
import { normalizeLocalBackup } from '../lib/localRepository.ts'
import {
  assertLocalReplacementCurrent,
  mergeLocalStates,
  prepareLocalReplacement,
} from '../lib/local-backup.ts'
import type { LocalReplacementReview } from '../lib/local-backup.ts'
import { say } from '../lib/labels.ts'

export default function LocalDataControls({
  state,
  language,
  disabled,
  recoveryRequired = false,
  mutation,
  onCommit,
  onRecover,
  onExport,
}: {
  state: LocalState
  language: Language
  disabled: boolean
  recoveryRequired?: boolean
  mutation: number
  onCommit: (state: LocalState) => Promise<'saved' | 'session' | 'conflict'>
  onRecover?: (state: LocalState) => Promise<'saved' | 'session' | 'conflict'>
  onExport: () => void
}) {
  const [preview, setPreview] = useState<{
      state: LocalState
      mutation: number
    } | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<LocalReplacementReview | null>(null)
  const reviewId = useId()
  const reviewTitle = useRef<HTMLHeadingElement>(null)
  const reviewPanel = useRef<HTMLElement>(null)
  const summary = useRef<HTMLElement>(null)
  const reviewTrigger = useRef<HTMLElement | null>(null)
  const fileRequest = useRef(0)
  const cancelFile = () => {
    fileRequest.current++
  }
  useEffect(() => () => cancelFile(), [])
  useEffect(() => {
    if (review) reviewTitle.current?.focus()
  }, [review])
  const t = (en: string, hi: string) => say(language, en, hi)
  const cancelReview = useCallback(() => {
    setReview(null)
    requestAnimationFrame(() => {
      const target = reviewTrigger.current
      if (target?.isConnected && !target.matches(':disabled')) target.focus()
      else summary.current?.focus()
    })
  }, [])
  useEffect(() => {
    if (!review) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !busy &&
        reviewPanel.current?.contains(document.activeElement)
      ) {
        event.preventDefault()
        cancelReview()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [review, busy, cancelReview])
  function openReview(
    mode: LocalReplacementReview['mode'],
    trigger: HTMLElement,
  ) {
    if (disabled || busy) return
    if (mode === 'replace' && (!preview || preview.mutation !== mutation)) {
      setError(
        t(
          'Planning data changed after this preview. Choose the file again and review it.',
          'पूर्वावलोकन के बाद योजना बदली। फ़ाइल फिर चुनें और जांचें।',
        ),
      )
      return
    }
    try {
      reviewTrigger.current = trigger
      setReview(
        prepareLocalReplacement(
          mode,
          state,
          mode === 'replace' ? preview!.state : state,
          mutation,
          recoveryRequired,
        ),
      )
      setError('')
      setNotice('')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The replacement could not be reviewed.',
      )
    }
  }
  async function mergeBackup() {
    if (!preview || disabled || busy) return
    if (preview.mutation !== mutation) {
      setError(
        'Planning data changed after this preview. Choose the file again and review it.',
      )
      return
    }
    if (recoveryRequired || review) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = mergeLocalStates(state, preview.state)
      const result = await onCommit(next)
      if (result === 'conflict')
        throw new Error(
          'Import was not applied. Resolve the storage conflict and review the backup again.',
        )
      setPreview(null)
      setNotice(
        result === 'saved'
          ? 'Validated backup applied and saved together in this browser.'
          : 'Validated backup applied for this session only. Export before leaving.',
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Backup could not import.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function confirmReplacement() {
    if (!review || disabled || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      assertLocalReplacementCurrent(review, mutation, recoveryRequired)
      if (review.recoveryRequired && !onRecover)
        throw new Error(
          'Stored recovery is unavailable. Original stored data was not changed.',
        )
      const result = review.recoveryRequired
        ? await onRecover!(review.replacement)
        : await onCommit(review.replacement)
      if (
        result === 'conflict' ||
        (review.recoveryRequired && result !== 'saved')
      )
        throw new Error(
          review.recoveryRequired
            ? t(
                'Recovery did not save. Original stored data was preserved. Reload and review storage, or export this session before leaving.',
                'रिकवरी सहेजी नहीं गई। मूल संग्रह सुरक्षित है। संग्रह दोबारा लोड और जांचें, या जाने से पहले सत्र निर्यात करें।',
              )
            : t(
                'Backup replacement was not applied. Resolve the storage conflict and review the backup again.',
                'बैकअप से बदलना लागू नहीं हुआ। संग्रह विरोध सुलझाएं और बैकअप फिर देखें।',
              ),
        )
      if (review.mode === 'replace') setPreview(null)
      setNotice(
        review.recoveryRequired
          ? t(
              'Reviewed planning saved. The damaged original remains available in the stored recovery export.',
              'देखी गई योजना सहेजी। क्षतिग्रस्त मूल संग्रह रिकवरी निर्यात में उपलब्ध है।',
            )
          : result === 'saved'
            ? t(
                'Reviewed backup applied and saved together in this browser.',
                'देखा गया बैकअप इस ब्राउज़र में एक साथ लागू और सहेजा गया।',
              )
            : t(
                'Reviewed backup applied for this session only. Export before leaving.',
                'देखा गया बैकअप केवल इस सत्र में लागू हुआ। जाने से पहले निर्यात करें।',
              ),
      )
      cancelReview()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Reviewed planning replacement failed.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="local-data-controls">
      <summary ref={summary}>
        {t('Restore a local backup', 'स्थानीय बैकअप वापस लाएं')}
      </summary>
      {recoveryRequired && onRecover && (
        <div className="preview-note" role="status">
          <h3>{t('Recover stored planning', 'संग्रह योजना वापस लाएं')}</h3>
          <p>
            {t(
              'The stored document cannot be used safely. Review a validated backup below or explicitly save this session. Recovery archives the damaged original before replacing it, in one transaction; export it from the privacy controls.',
              'संग्रह दस्तावेज़ सुरक्षित उपयोग योग्य नहीं है। नीचे सत्यापित बैकअप देखें या स्पष्ट रूप से इस सत्र को सहेजें। रिकवरी एक ही लेनदेन में बदलने से पहले क्षतिग्रस्त मूल सुरक्षित करती है; गोपनीयता नियंत्रण से निर्यात करें।',
            )}
          </p>
          <p>
            {state.plan.name} · {state.plan.activities.length}{' '}
            {t('recurring activities', 'नियमित गतिविधियां')} ·{' '}
            {state.oneOffs.length} {t('quick activities', 'त्वरित गतिविधियां')}{' '}
            · {state.journal.length}{' '}
            {t('decision records in this session', 'इस सत्र के निर्णय रिकॉर्ड')}
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              type="button"
              onClick={onExport}
            >
              {t(
                'Export current session first',
                'पहले वर्तमान सत्र निर्यात करें',
              )}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={disabled || busy || Boolean(review)}
              onClick={(event) =>
                openReview('recover_session', event.currentTarget)
              }
            >
              {t('Review and save this session', 'देखें और इस सत्र को सहेजें')}
            </button>
          </div>
        </div>
      )}
      <p className="help-text">
        {t(
          'Only the versioned Airday planning JSON export is supported. Review it before merging or replacing; exact detected coordinates are not included in the planning export. Import does not send data to a server.',
          'केवल संस्करण वाला Airday योजना JSON समर्थित है। मिलाने या बदलने से पहले देखें; योजना निर्यात में सटीक पहचाने गए निर्देशांक नहीं होते। आयात डेटा सर्वर पर नहीं भेजता।',
        )}
      </p>
      <label>
        {t(
          'Choose planning JSON · maximum 2 MB',
          'योजना JSON चुनें · अधिकतम 2 MB',
        )}
        <input
          type="file"
          accept=".json,application/json"
          disabled={disabled || busy || Boolean(review)}
          onChange={async (e) => {
            const file = e.target.files?.[0],
              id = ++fileRequest.current,
              atMutation = mutation
            setError('')
            setNotice('')
            setPreview(null)
            if (!file) return
            if (file.size > 2 * 1024 * 1024) {
              setError('Choose a planning export no larger than 2 MB.')
              e.target.value = ''
              return
            }
            try {
              const doc = JSON.parse(await file.text())
              if (id !== fileRequest.current) return
              if (
                ![1, 2].includes(doc?.schemaVersion) ||
                !Number.isSafeInteger(doc.revision) ||
                doc.revision < 0 ||
                !normalizeLocalBackup(doc.schemaVersion, doc.state)
              )
                throw new Error(
                  'Unsupported or invalid planning backup. No stored data was changed.',
                )
              setPreview({
                state: normalizeLocalBackup(doc.schemaVersion, doc.state)!,
                mutation: atMutation,
              })
            } catch (cause) {
              if (id === fileRequest.current)
                setError(
                  cause instanceof Error
                    ? cause.message
                    : 'Backup could not read.',
                )
            }
            e.target.value = ''
          }}
        />
      </label>
      {preview && (
        <div className="preview-note">
          <h3>{t('Backup preview', 'बैकअप पूर्वावलोकन')}</h3>
          <p>
            {preview.state.plan.name} · {preview.state.plan.activities.length}{' '}
            {t('recurring activities', 'नियमित गतिविधियां')} ·{' '}
            {preview.state.oneOffs.length}{' '}
            {t('quick activities', 'त्वरित गतिविधियां')} ·{' '}
            {preview.state.journal.length}{' '}
            {t('decision records', 'निर्णय रिकॉर्ड')}
          </p>
          <p className="help-text">
            {t(
              'Merge keeps your current recurring plan and preferences. Duplicate IDs with different content are rejected. Replacement imports the whole document. Superseded and reopened evidence remains historical; older records without provenance cannot become current.',
              'मिलाने पर वर्तमान नियमित योजना और प्राथमिकताएं रहती हैं। अलग सामग्री वाले समान ID अस्वीकार किए जाते हैं। बदलने पर पूरा दस्तावेज़ आयात होता है। पुराने और फिर खोले रिकॉर्ड ऐतिहासिक रहते हैं; संदर्भ बिना रिकॉर्ड वर्तमान नहीं बनते।',
            )}
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              type="button"
              onClick={onExport}
            >
              {t('Export current data first', 'पहले वर्तमान डेटा निर्यात करें')}
            </button>
            <button
              className="button primary"
              type="button"
              disabled={disabled || busy || recoveryRequired || Boolean(review)}
              onClick={() => void mergeBackup()}
            >
              {t('Merge records', 'रिकॉर्ड मिलाएं')}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={disabled || busy || Boolean(review)}
              onClick={(event) => openReview('replace', event.currentTarget)}
            >
              {recoveryRequired
                ? t('Recover with this backup', 'इस बैकअप से रिकवरी करें')
                : t('Replace with this backup', 'इस बैकअप से बदलें')}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy || Boolean(review)}
              onClick={() => setPreview(null)}
            >
              {t('Cancel import', 'आयात रद्द करें')}
            </button>
          </div>
        </div>
      )}
      {review && (
        <section
          className="delete-confirmation"
          ref={reviewPanel}
          aria-labelledby={reviewId}
          aria-describedby={`${reviewId}-description`}
        >
          <h3 id={reviewId} ref={reviewTitle} tabIndex={-1}>
            {review.recoveryRequired
              ? t(
                  'Review stored planning recovery',
                  'संग्रह योजना रिकवरी देखें',
                )
              : t('Review backup replacement', 'बैकअप से बदलना देखें')}
          </h3>
          <p id={`${reviewId}-description`}>
            {review.recoveryRequired
              ? t(
                  'Confirmation archives the damaged stored original in this browser and saves the reviewed replacement in one transaction. The archive remains available through Export stored recovery copy. Export current data and stored recovery first.',
                  'पुष्टि क्षतिग्रस्त मूल ब्राउज़र में सुरक्षित करके एक ही लेनदेन में देखी गई नई योजना सहेजती है। मूल संग्रह रिकवरी निर्यात से उपलब्ध रहेगा। पहले वर्तमान डेटा और संग्रह रिकवरी निर्यात करें।',
                )
              : t(
                  'Confirmation replaces the local plan, decisions, quick activities, favorites, groups, feedback and preferences with this reviewed backup. Export current data first.',
                  'पुष्टि इस देखे गए बैकअप से स्थानीय योजना, निर्णय, गतिविधि, क्षेत्र, समूह, प्रतिक्रिया और प्राथमिकता बदलती है। पहले वर्तमान डेटा निर्यात करें।',
                )}
          </p>
          <p>
            <strong>{t('Current session', 'वर्तमान सत्र')}:</strong>{' '}
            {review.current.plan.name} · {review.current.plan.activities.length}{' '}
            {t('recurring activities', 'नियमित गतिविधियां')} ·{' '}
            {review.current.oneOffs.length}{' '}
            {t('quick activities', 'त्वरित गतिविधियां')} ·{' '}
            {review.current.journal.length}{' '}
            {t('decision records', 'निर्णय रिकॉर्ड')}
          </p>
          <p className="help-text">
            {review.current.favorites.length} {t('favorites', 'सहेजे क्षेत्र')}{' '}
            · {review.current.groups?.length || 0} {t('groups', 'समूह')} ·{' '}
            {review.current.feedback.length}{' '}
            {t('feedback entries', 'प्रतिक्रिया प्रविष्टियां')} ·{' '}
            {t('language', 'भाषा')}: {review.current.language}
          </p>
          <p>
            <strong>{t('Reviewed replacement', 'देखी गई नई योजना')}:</strong>{' '}
            {review.replacement.plan.name} ·{' '}
            {review.replacement.plan.activities.length}{' '}
            {t('recurring activities', 'नियमित गतिविधियां')} ·{' '}
            {review.replacement.oneOffs.length}{' '}
            {t('quick activities', 'त्वरित गतिविधियां')} ·{' '}
            {review.replacement.journal.length}{' '}
            {t('decision records', 'निर्णय रिकॉर्ड')}
          </p>
          <p className="help-text">
            {review.replacement.favorites.length}{' '}
            {t('favorites', 'सहेजे क्षेत्र')} ·{' '}
            {review.replacement.groups?.length || 0} {t('groups', 'समूह')} ·{' '}
            {review.replacement.feedback.length}{' '}
            {t('feedback entries', 'प्रतिक्रिया प्रविष्टियां')} ·{' '}
            {t('language', 'भाषा')}: {review.replacement.language}
          </p>
          {(review.mutation !== mutation ||
            review.recoveryRequired !== recoveryRequired) && (
            <p className="field-error" role="alert">
              {t(
                'Planning data changed after this review. Cancel and review the current data again.',
                'इस समीक्षा के बाद योजना बदली। रद्द करें और वर्तमान डेटा फिर देखें।',
              )}
            </p>
          )}
          <div className="button-row">
            <button
              className="button secondary"
              type="button"
              onClick={onExport}
            >
              {t('Export current data first', 'पहले वर्तमान डेटा निर्यात करें')}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={cancelReview}
            >
              {t('Cancel replacement', 'बदलना रद्द करें')}
            </button>
            <button
              className="button danger"
              type="button"
              disabled={
                disabled ||
                busy ||
                review.mutation !== mutation ||
                review.recoveryRequired !== recoveryRequired
              }
              onClick={() => void confirmReplacement()}
            >
              {busy
                ? t('Saving reviewed planning…', 'देखी गई योजना सहेज रहे हैं…')
                : review.recoveryRequired
                  ? t(
                      'Confirm reviewed recovery',
                      'देखी गई रिकवरी की पुष्टि करें',
                    )
                  : t(
                      'Confirm backup replacement',
                      'बैकअप से बदलने की पुष्टि करें',
                    )}
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </details>
  )
}
