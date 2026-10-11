import type { DecisionRecord, Language } from '../types.ts'
import { decisionSummary } from '../lib/summary.ts'
import { say } from '../lib/labels.ts'
export default function DecisionSummary({
  record,
  language = 'en',
  includePrivate = false,
}: {
  record: DecisionRecord
  language?: Language
  includePrivate?: boolean
}) {
  const text = decisionSummary(record, language, { includePrivate })
  const t = (en: string, hi: string) => say(language, en, hi)
  return (
    <details className="card workspace-panel">
      <summary>
        {t(
          'Preview a shareable decision summary',
          'साझा करने योग्य निर्णय का पूर्वावलोकन',
        )}
      </summary>
      <p className="help-text">
        {t(
          includePrivate
            ? 'Private labels and your reason are included because you selected that option above. Review before sharing. Coordinates are omitted. Airday does not send it automatically.'
            : 'Private activity, plan and place labels and your reason are omitted. Use the option above to include them. Coordinates are always omitted. Airday does not send it automatically.',
          includePrivate
            ? 'ऊपर चुने विकल्प के कारण निजी नाम और आपका कारण शामिल हैं। साझा करने से पहले देखें। निर्देशांक शामिल नहीं हैं। Airday इसे अपने आप नहीं भेजता।'
            : 'निजी गतिविधि, योजना, स्थान नाम और आपका कारण शामिल नहीं हैं। इन्हें शामिल करने के लिए ऊपर का विकल्प चुनें। निर्देशांक हमेशा छोड़े जाते हैं। Airday इसे अपने आप नहीं भेजता।',
        )}
      </p>
      <pre className="decision-summary" lang={language}>
        {text}
      </pre>
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          const url = URL.createObjectURL(
              new Blob([text], { type: 'text/plain;charset=utf-8' }),
            ),
            link = document.createElement('a')
          link.href = url
          link.download = `airday-decision-${record.date}-${language}.txt`
          link.click()
          window.setTimeout(() => URL.revokeObjectURL(url), 1000)
        }}
      >
        {t('Download selected summary', 'चुना सारांश डाउनलोड करें')}
      </button>
    </details>
  )
}
