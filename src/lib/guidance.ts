import type { ActivityView } from './activity-view.ts'
import type { Language } from '../types.ts'
import { say } from './labels.ts'
import { concentration } from './planner.ts'

/** Uses the same activity view as the timeline; no policy or medical inference. */
export function planningGuidance(
  views: ActivityView[],
  language: Language,
  forecastFresh: boolean,
) {
  const t = (en: string, hi: string) => say(language, en, hi)
  const active = views.filter((v) => v.status !== 'preview' && !v.passed)
  if (!views.length)
    return {
      code: 'empty',
      prompt: t(
        'Add an activity and its allowed hours to start a review.',
        'समीक्षा शुरू करने के लिए गतिविधि और उसके अनुमत घंटे जोड़ें।',
      ),
    }
  if (views.every((v) => v.status === 'preview'))
    return {
      code: 'preview',
      prompt: t(
        'Confirm your location and save your own plan before treating example activities as your decisions.',
        'उदाहरण गतिविधियों को अपना निर्णय मानने से पहले स्थान की पुष्टि और अपनी योजना सहेजें।',
      ),
    }
  if (!active.length)
    return {
      code: 'finished',
      prompt: t(
        'These activity windows have ended. Recorded evidence is historical; choose an upcoming date to plan another activity.',
        'इन गतिविधियों का समय समाप्त हो गया है। दर्ज डेटा ऐतिहासिक है; अगली गतिविधि के लिए आने वाली तारीख चुनें।',
      ),
    }
  if (!forecastFresh)
    return {
      code: 'stale',
      prompt: t(
        'Refresh the forecast before comparing activity times. Missing or stale evidence cannot establish a lower-pollution window.',
        'समय की तुलना से पहले पूर्वानुमान रीफ़्रेश करें। अधूरा या पुराना डेटा कम प्रदूषण वाले समय का प्रमाण नहीं है।',
      ),
    }
  const incomplete = active.find(
    (v) =>
      v.unresolved &&
      (v.status === 'unavailable' ||
        v.coverage !== 'complete' ||
        (v.current && v.chosen.coverage !== 'complete')),
  )
  if (incomplete)
    return {
      code: 'incomplete',
      prompt: t(
        `The forecast for ${incomplete.activity} is incomplete or unavailable. Check the missing evidence; a partial peak cannot establish a lower-pollution window.`,
        `${incomplete.activity} का पूर्वानुमान अधूरा या उपलब्ध नहीं है। खाली डेटा देखें; अधूरा अधिकतम कम प्रदूषण वाले समय का प्रमाण नहीं है।`,
      ),
    }
  const attention = active.find(
    (v) => v.unresolved && ['review', 'recheck', 'reopened'].includes(v.status),
  )
  if (attention) {
    const prompt =
      attention.status === 'review'
        ? t(
            `Review ${attention.activity}: the regional PM2.5 forecast peak of ${concentration(attention.value)} µg/m³ exceeds your ${attention.contextPlan.threshold} µg/m³ review rule.`,
            `${attention.activity} की समीक्षा करें: क्षेत्रीय PM2.5 पूर्वानुमान का ${concentration(attention.value)} µg/m³ अधिकतम आपकी ${attention.contextPlan.threshold} µg/m³ समीक्षा सीमा से ऊपर है।`,
          )
        : t(
            `Review ${attention.activity} again before relying on the recorded response; the evidence changed or the decision was reopened.`,
            `दर्ज निर्णय पर निर्भर होने से पहले ${attention.activity} की फिर समीक्षा करें; डेटा बदला या निर्णय की समीक्षा फिर शुरू हुई है।`,
          )
    const options = [
      attention.alternatives.length
        ? t(
            'Compare the available lower model windows within the allowed hours.',
            'अनुमत घंटों में उपलब्ध कम मॉडल मान वाले समय की तुलना करें।',
          )
        : t(
            'No lower model window is offered within the configured constraints.',
            'चुनी सीमाओं में कम मॉडल मान वाला समय उपलब्ध नहीं दिखाया गया है।',
          ),
      attention.indoorAvailable
        ? t(
            'You marked an indoor option as available; confirm its suitability and indoor air before choosing it.',
            'आपने अंदर का विकल्प उपलब्ध बताया है; चुनने से पहले उसकी उपयुक्तता और अंदर की हवा जाँचें।',
          )
        : t(
            'No indoor alternative is configured. Review whether shortening or cancelling is feasible before recording your reason.',
            'अंदर का विकल्प दर्ज नहीं है। कारण दर्ज करने से पहले देखें कि अवधि कम करना या रद्द करना संभव है या नहीं।',
          ),
    ].join(' ')
    return { code: attention.status, prompt, options }
  }
  const ready = active.find((v) => v.unresolved)
  return ready
    ? {
        code: 'ready',
        prompt: t(
          `${ready.activity} is at or below your review rule with complete available forecast coverage. This does not establish safe air. Review nearby observations and record your chosen response.`,
          `${ready.activity} का उपलब्ध पूर्वानुमान पूरा है और मान आपकी समीक्षा सीमा के बराबर या नीचे है। इससे सुरक्षित हवा साबित नहीं होती। नज़दीकी अवलोकन देखें और अपना निर्णय दर्ज करें।`,
        ),
      }
    : {
        code: 'recorded',
        prompt: t(
          'Your active decisions are recorded. Recheck if evidence or constraints change; confirm follow-through separately.',
          'आपके सक्रिय निर्णय दर्ज हैं। डेटा या सीमाएँ बदलें तो फिर जाँचें; पालन की पुष्टि अलग से करें।',
        ),
      }
}
