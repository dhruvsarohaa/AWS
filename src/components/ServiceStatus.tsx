import type { Language } from '../types.ts'
import { say } from '../lib/labels.ts'
import type { useServiceStatus } from '../hooks/useServiceStatus.ts'

export default function ServiceStatus({
  status,
  language,
}: {
  status: ReturnType<typeof useServiceStatus>
  language: Language
}) {
  const t = (en: string, hi: string) => say(language, en, hi)
  const connections = [
    ['sharedWorkspaces', 'Shared responsibilities', 'साझा ज़िम्मेदारियाँ'],
    ['localGroups', 'Site & area groups', 'स्थान और क्षेत्र समूह'],
    ['reviewEmail', 'Email alerts & daily briefs', 'ईमेल अलर्ट और दैनिक सार'],
    [
      'publicEvidence',
      'Public display, API & widget',
      'सार्वजनिक डिस्प्ले, API और विजेट',
    ],
    ['weather', 'Weather context', 'मौसम संदर्भ'],
    ['fires', 'Satellite-fire context', 'उपग्रह आग संदर्भ'],
  ] as const
  return (
    <section
      id="service-status"
      tabIndex={-1}
      className="card service-status"
      aria-labelledby="service-status-title"
      aria-busy={status.loading}
    >
      <div className="section-heading">
        <div>
          <h2 id="service-status-title">
            {t('What is available here', 'यहाँ क्या उपलब्ध है')}
          </h2>
        </div>
        <button
          type="button"
          className="button secondary"
          disabled={status.loading}
          onClick={status.retry}
        >
          {status.loading
            ? t('Checking…', 'जाँच जारी…')
            : t('Check connection', 'कनेक्शन जाँचें')}
        </button>
      </div>
      <p role="status">
        {status.loading
          ? t(
              'Loading the current service settings…',
              'सेवा सेटिंग्स लोड हो रही हैं…',
            )
          : status.responding
            ? t('App service responding.', 'ऐप सेवा उपलब्ध है।')
            : t('App service unavailable.', 'ऐप सेवा उपलब्ध नहीं है।')}
        {status.fixture && ' · SYNTHETIC QA'}
      </p>
      {status.error && (
        <p role="alert" className="field-error">
          {status.error}
        </p>
      )}
      <p className="help-text">
        {t(
          'Planning, saved places, decisions, reports and offline reading work locally. Service reachability does not verify forecast freshness or provider availability; check Evidence for those.',
          'योजना, सहेजे स्थान, निर्णय, रिपोर्ट और ऑफलाइन पढ़ना स्थानीय हैं। सेवा उपलब्ध होने से ताज़ा पूर्वानुमान की पुष्टि नहीं होती; उसे डेटा में जाँचें।',
        )}
      </p>
      {status.config && (
        <>
          {status.config.releaseScope === 'R0R2' && (
            <p className="connection-note">
              {t(
                'Shared and external connections are paused for this release. Your local planning tools remain available.',
                'इस रिलीज़ में साझा और बाहरी कनेक्शन रुके हैं। आपके स्थानीय योजना साधन उपलब्ध हैं।',
              )}
            </p>
          )}
          <dl className="connection-list">
            {connections.map(([key, en, hi]) => (
              <div key={key}>
                <dt>{t(en, hi)}</dt>
                <dd>
                  {status.config!.capabilities[key]
                    ? t('Enabled', 'सक्रिय')
                    : status.config!.releaseScope === 'R0R2'
                      ? t('Paused for this release', 'इस रिलीज़ में रुका है')
                      : t(
                          'Not enabled — setup required',
                          'सक्रिय नहीं — सेटअप आवश्यक',
                        )}
                </dd>
              </div>
            ))}
          </dl>
          <details className="pilot-availability">
            <summary>
              {t('Journey & device pilots', 'यात्रा और उपकरण पायलट')}
            </summary>
            <p>
              {status.config.capabilities.r4?.localJourneys
                ? t(
                    'Local journey tools are available in History.',
                    'स्थानीय यात्रा साधन इतिहास में उपलब्ध हैं।',
                  )
                : t(
                    'Journey recording and GPX tools are not enabled in this release.',
                    'इस रिलीज़ में यात्रा रिकॉर्डिंग और GPX साधन सक्रिय नहीं हैं।',
                  )}
            </p>
            <p>
              {status.config.capabilities.r5?.indoorDevices
                ? t(
                    'Device tools are available below. Commands require an authorized, configured device.',
                    'उपकरण साधन नीचे उपलब्ध हैं। कमांड के लिए अधिकृत, कॉन्फ़िगर किया उपकरण चाहिए।',
                  )
                : t(
                    'Indoor sensors, purifier and site ventilation controls require an enabled hardware pilot.',
                    'इनडोर सेंसर, प्यूरीफायर और वेंटिलेशन नियंत्रण के लिए सक्रिय हार्डवेयर पायलट चाहिए।',
                  )}
            </p>
            <p>
              {t(
                'AI explanations, route comparison, wearables, pollen and fine-scale maps require separate provider access and a validated pilot before use.',
                'AI व्याख्या, मार्ग तुलना, पहनने वाले उपकरण, पराग और सूक्ष्म नक्शों के उपयोग से पहले अलग स्रोत और सत्यापित पायलट चाहिए।',
              )}
            </p>
          </details>
        </>
      )}
      {!status.loading && status.checkedAt && (
        <p className="help-text">
          {t('Last checked', 'अंतिम जाँच')}:{' '}
          {new Date(status.checkedAt).toLocaleString(
            language === 'hi' ? 'hi-IN' : 'en-IN',
            { timeZone: 'Asia/Kolkata' },
          )}{' '}
          IST
        </p>
      )}
    </section>
  )
}
