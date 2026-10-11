import type { ActivityDecision, Language } from '../types.ts'
export const say = (language: Language, en: string, hi: string) =>
  language === 'hi' ? hi : en
/** Human labels for retained enums; unknown metadata stays explicit. */
export function stateLabel(
  value: string | undefined,
  language: Language = 'en',
) {
  const labels: Record<string, [string, string]> = {
    recorded: ['Recorded', 'दर्ज'],
    reopened: ['Reopened for review', 'समीक्षा फिर शुरू'],
    superseded: ['Replaced by a later record', 'बाद के रिकॉर्ड से बदला'],
    legacy: ['Older record', 'पुराना रिकॉर्ड'],
    complete: ['Complete coverage', 'पूरा डेटा'],
    partial: ['Partial coverage', 'अधूरा डेटा'],
    missing: ['No available values', 'मान उपलब्ध नहीं'],
    fresh: ['Recent retrieval at review', 'समीक्षा के समय ताज़ा डेटा'],
    stale: ['Old data', 'पुराना डेटा'],
    future: ['Time ahead of device clock', 'डिवाइस के समय से आगे'],
    unknown: ['Unverified', 'अप्रमाणित'],
    unconfirmed: ['Follow-through not confirmed', 'पालन की पुष्टि नहीं'],
    completed: ['Action followed', 'निर्णय का पालन किया'],
    changed: ['Changed afterward', 'बाद में बदला'],
    verification_needed: ['Verification needed', 'सत्यापन चाहिए'],
    reviewed_guidance: ['Reviewed guidance', 'समीक्षित निर्देश'],
    not_configured: ['Not connected', 'जुड़ा नहीं है'],
    unavailable: ['Unavailable', 'उपलब्ध नहीं'],
    pending: ['Awaiting retrieval', 'डेटा की प्रतीक्षा'],
  }
  if (!value) return say(language, 'Not retained', 'दर्ज नहीं')
  return (
    labels[value]?.[language === 'hi' ? 1 : 0] || value.replaceAll('_', ' ')
  )
}
export function actionLabel(
  choice: ActivityDecision,
  language: Language = 'en',
) {
  const labels: Record<ActivityDecision, [string, string]> = {
    pending: ['Pending review', 'समीक्षा बाकी'],
    indoors: ['Move indoors', 'अंदर करें'],
    outdoors: ['Keep outdoors', 'बाहर करें'],
    cancelled: ['Cancel activity', 'गतिविधि रद्द करें'],
    rescheduled: ['Choose another time', 'दूसरा समय चुनें'],
    shortened: ['Shorten activity', 'समय कम करें'],
  }
  return labels[choice][language === 'hi' ? 1 : 0]
}

/** Translate only deterministic local review reasons. User/source text is unchanged. */
export function reviewReasonLabel(
  reason: string,
  language: Language = 'en',
): string {
  if (language !== 'hi') return reason
  const window = reason.match(/^For the (chosen|original) window: (.+)$/)
  if (window)
    return `${window[1] === 'chosen' ? 'चुने गए समय के लिए' : 'मूल समय के लिए'}: ${reviewReasonLabel(window[2], language)}`
  const freshness = reason.match(
    /^Forecast freshness has changed to (stale|future|unknown)\.$/,
  )
  if (freshness)
    return `पूर्वानुमान के डेटा की स्थिति बदली है: ${stateLabel(freshness[1], language)}।`
  const currentFreshness = reason.match(
    /^Current forecast retrieval is (stale|future|unknown)\. Refresh before using this decision\.$/,
  )
  if (currentFreshness)
    return `वर्तमान पूर्वानुमान की स्थिति: ${stateLabel(currentFreshness[1], language)}। इस निर्णय का उपयोग करने से पहले डेटा रीफ़्रेश करें।`
  const reasons: Record<string, string> = {
    'The forecast reviewed in this editor is no longer fresh.':
      'इस संपादक में समीक्षा किया गया पूर्वानुमान अब ताज़ा नहीं है।',
    'A fresh, successfully retrieved forecast is required before recording.':
      'दर्ज करने से पहले सफलतापूर्वक प्राप्त ताज़ा पूर्वानुमान चाहिए।',
    'The forecast crossed above the review rule.':
      'पूर्वानुमान आपकी समीक्षा सीमा से ऊपर चला गया है।',
    'The forecast returned to or below the review rule.':
      'पूर्वानुमान आपकी समीक्षा सीमा के बराबर या नीचे आ गया है।',
    'Forecast coverage has changed.':
      'पूर्वानुमान के उपलब्ध डेटा की मात्रा बदली है।',
    'Forecast availability has changed.': 'पूर्वानुमान की उपलब्धता बदली है।',
    'The current forecast window has no usable PM2.5 values.':
      'वर्तमान समय के पूर्वानुमान में उपयोगी PM2.5 मान नहीं हैं।',
    'The current forecast window has only partial PM2.5 coverage.':
      'वर्तमान समय के पूर्वानुमान में PM2.5 का केवल अधूरा डेटा है।',
    'The forecast peak has changed materially.':
      'पूर्वानुमान का अधिकतम मान काफी बदल गया है।',
    'The reviewed location was not retained. Review this legacy record again.':
      'समीक्षा का स्थान दर्ज नहीं है। इस पुराने रिकॉर्ड की फिर समीक्षा करें।',
    'The selected location has changed since this decision.':
      'इस निर्णय के बाद चुना गया स्थान बदल गया है।',
    'Current evidence is for a different selected location.':
      'वर्तमान डेटा किसी दूसरे चुने गए स्थान का है।',
    'The outdoor plan or review rule has changed.':
      'बाहर की गतिविधियों की योजना या समीक्षा सीमा बदल गई है।',
    'The retained decision date is invalid.':
      'दर्ज निर्णय की तारीख मान्य नहीं है।',
    'This activity is no longer scheduled on the retained decision date.':
      'दर्ज निर्णय की तारीख पर यह गतिविधि अब निर्धारित नहीं है।',
    'The current guidance applies to a different date.':
      'वर्तमान निर्देश किसी दूसरी तारीख के लिए हैं।',
    'The guidance version has changed.': 'निर्देशों का संस्करण बदल गया है।',
    'The reviewed guidance status was not retained. Review this legacy record again.':
      'समीक्षा के समय निर्देशों की स्थिति दर्ज नहीं है। इस पुराने रिकॉर्ड की फिर समीक्षा करें।',
    'The guidance verification status has changed.':
      'निर्देशों के सत्यापन की स्थिति बदल गई है।',
    'The original window evidence was not retained. Review this legacy record again.':
      'मूल समय का डेटा दर्ज नहीं है। इस पुराने रिकॉर्ड की फिर समीक्षा करें।',
    'The chosen window evidence was not retained. Review this legacy record again.':
      'चुने गए समय का डेटा दर्ज नहीं है। इस पुराने रिकॉर्ड की फिर समीक्षा करें।',
  }
  return reasons[reason] || reason
}
