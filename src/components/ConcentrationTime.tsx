import type { DashboardData, Language } from '../types.ts'
import { concentrationTimeComparison } from '../lib/concentration-time.ts'
import { say } from '../lib/labels.ts'
export default function ConcentrationTime({
  data,
  date,
  start,
  end,
  chosen,
  language,
  now,
}: {
  data: DashboardData | null
  date: string
  start: string
  end: string
  chosen?: { start: string; end: string }
  language: Language
  now: number
}) {
  const comparison = concentrationTimeComparison(
      data,
      date,
      { start, end },
      chosen,
      now,
    ),
    { original, chosen: alternative } = comparison,
    t = (en: string, hi: string) => say(language, en, hi)
  return (
    <details className="concentration-time">
      <summary>
        {t(
          'Current model concentration × planned time',
          'वर्तमान मॉडल सांद्रता × नियोजित समय',
        )}
      </summary>
      <p>
        {start}–{end}:{' '}
        {comparison.originalValue !== null
          ? comparison.originalValue.toFixed(1)
          : '—'}{' '}
        µg·h/m³ · {original.covered.toFixed(2)}/{original.duration.toFixed(2)} h{' '}
        {t('covered', 'उपलब्ध')}.
      </p>
      {alternative && (
        <p>
          {chosen!.start}–{chosen!.end}:{' '}
          {comparison.chosenValue !== null
            ? comparison.chosenValue.toFixed(1)
            : '—'}{' '}
          µg·h/m³ · {alternative.covered.toFixed(2)}/
          {alternative.duration.toFixed(2)} h {t('covered', 'उपलब्ध')}
        </p>
      )}
      <p className="help-text">
        {t(
          'Current regional PM2.5 model estimate using hourly samples held for one hour and exact interval overlap. The estimate reviewed earlier stays frozen in History. Incomplete or stale comparisons are withheld. This is not inhaled dose, indoor exposure, a health score or a claimed exposure saving. No breathing rate, building filtration or actual activity duration is measured.',
          'वर्तमान क्षेत्रीय PM2.5 मॉडल अनुमान; घंटे के नमूने और समय का उपयोग। पिछली समीक्षा का अनुमान इतिहास में स्थिर रहता है। अधूरे या पुराने डेटा की तुलना नहीं। यह सांस में गई मात्रा, घर के अंदर का संपर्क, स्वास्थ्य अंक या बचत नहीं है।',
        )}
      </p>
    </details>
  )
}
