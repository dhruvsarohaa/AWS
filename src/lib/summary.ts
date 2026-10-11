import type { DecisionRecord, Language } from '../types.ts'
import { actionLabel, say, stateLabel } from './labels.ts'
import {
  reportDetails,
  retainedConcentration,
  type ReportOptions,
} from './reports.ts'

export function decisionSummary(
  record: DecisionRecord,
  language: Language,
  options: ReportOptions = {},
) {
  const t = (en: string, hi: string) => say(language, en, hi)
  const details = reportDetails(record, options, language)
  const value = (amount: number | null | undefined) => {
    const number = retainedConcentration(amount)
    return number === null
      ? t('unavailable', 'उपलब्ध नहीं')
      : `${new Intl.NumberFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { maximumFractionDigits: 2 }).format(number)} µg/m³`
  }
  // Older `value` fields do not establish original-window provenance.
  const original = value(record.originalAssessment?.value)
  const chosen = value(record.chosenAssessment?.value)
  const originalTime = record.originalWindow
    ? `${record.originalWindow.start}–${record.originalWindow.end} IST`
    : t('Not retained', 'दर्ज नहीं')
  const chosenTime = record.chosenWindow
    ? `${record.chosenWindow.start}–${record.chosenWindow.end} IST`
    : t('Not retained', 'दर्ज नहीं')
  const lines = [
    t(
      'Airday — historical user decision',
      'Airday — उपयोगकर्ता का ऐतिहासिक निर्णय',
    ),
    `${t('Activity', 'गतिविधि')}: ${details.activity}`,
    `${t('Plan at review', 'समीक्षा के समय की योजना')}: ${details.plan}`,
    `${t('Location', 'स्थान')}: ${details.location}`,
    `${t('Date', 'दिनांक')}: ${record.date} (IST)`,
    `${t('Action', 'निर्णय')}: ${actionLabel(record.choice, language)}`,
    `${t('Record state', 'रिकॉर्ड की स्थिति')}: ${stateLabel(record.lifecycle || 'legacy', language)}`,
    `${t('Follow-through', 'पालन')}: ${stateLabel(record.followThrough, language)}`,
    `${t('Original time', 'मूल समय')}: ${originalTime}`,
    `${t('Chosen time', 'चुना गया समय')}: ${chosenTime}`,
    `${t('Reason', 'कारण (उपयोगकर्ता द्वारा लिखा गया)')}: ${details.reason}`,
    `${t('Regional PM2.5 forecast peak in the original window', 'मूल गतिविधि अवधि में क्षेत्रीय PM2.5 पूर्वानुमान का अधिकतम मान')}: ${original}`,
    `${t('Regional PM2.5 forecast peak in the chosen window', 'चुनी गई अवधि में क्षेत्रीय PM2.5 पूर्वानुमान का अधिकतम मान')}: ${chosen}`,
    `${t('Original coverage / freshness at review', 'मूल अवधि का डेटा / समीक्षा के समय ताज़गी')}: ${stateLabel(record.originalAssessment?.coverage, language)} / ${stateLabel(record.originalAssessment?.freshness, language)}`,
    `${t('Chosen coverage / freshness at review', 'चुनी अवधि का डेटा / समीक्षा के समय ताज़गी')}: ${stateLabel(record.chosenAssessment?.coverage, language)} / ${stateLabel(record.chosenAssessment?.freshness, language)}`,
    `${t('User review threshold', 'चुनी गई समीक्षा सीमा')}: ${value(record.threshold)}`,
    `${t('Forecast source', 'पूर्वानुमान स्रोत')}: ${record.forecastSource || t('Not retained', 'दर्ज नहीं')}`,
    `${t('Forecast retrieved at', 'पूर्वानुमान प्राप्त समय')}: ${record.sourceAt || t('Not retained', 'दर्ज नहीं')}`,
    `${t('Guidance version / status', 'निर्देश संस्करण / स्थिति')}: ${record.policyVersion || t('Not retained', 'दर्ज नहीं')} / ${stateLabel(record.policyStatus, language)}`,
    `${t('Evidence ID', 'डेटा ID')}: ${record.snapshotId}`,
    `${t('Record ID / recorded at', 'रिकॉर्ड ID / दर्ज समय')}: ${record.id || t('Not retained', 'दर्ज नहीं')} / ${record.at || t('Not retained', 'दर्ज नहीं')}`,
    `${t('Plan version', 'योजना संस्करण')}: ${record.planVersion || t('Not retained', 'दर्ज नहीं')}`,
  ]
  if (record.reopenedAt)
    lines.push(
      `${t('Reopened at', 'समीक्षा फिर शुरू होने का समय')}: ${record.reopenedAt}`,
    )
  if (record.supersededBy)
    lines.push(
      `${t('Replaced by record', 'बाद के रिकॉर्ड से बदला')}: ${record.supersededBy}`,
    )
  lines.push(
    t(
      'Historical evidence, not a current advisory. This is a regional forecast, not a measurement at your building or official Indian AQI. Check applicable directions. This is your decision, not a government order. Indoor air needs a separate check. Indoor/cancelled actions retain the outdoor comparison window; they do not estimate indoor exposure or pollution avoided.',
      'यह ऐतिहासिक डेटा है, वर्तमान सलाह नहीं। यह क्षेत्रीय पूर्वानुमान है, आपके भवन का मापन या आधिकारिक भारतीय AQI नहीं। स्थानीय निर्देशों की जाँच करें। यह सरकारी आदेश नहीं है। अंदर की हवा की गुणवत्ता अलग से जाँचें। अंदर या रद्द गतिविधियों का बाहरी समय संदर्भ के लिए रखा जाता है; अंदर के संपर्क या बचाए गए प्रदूषण का अनुमान नहीं है।',
    ),
  )
  return lines.join('\n')
}
