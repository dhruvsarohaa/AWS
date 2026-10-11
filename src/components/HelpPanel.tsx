import { useState } from 'react'
import type { DashboardData, Language } from '../types.ts'
import { say } from '../lib/labels.ts'
const entries = [
  [
    'Why review an activity?',
    'गतिविधि की समीक्षा क्यों?',
    'An available PM2.5 model value above your chosen threshold prompts review. Missing, old or materially changed evidence may also need review. You choose the response; this is not an official order.',
    'आपकी चुनी सीमा से ऊपर उपलब्ध PM2.5 मॉडल मान समीक्षा का संकेत देता है। अधूरे, पुराने या बदले डेटा की भी समीक्षा चाहिए। निर्णय आपका है; यह आधिकारिक आदेश नहीं है।',
  ],
  [
    'What is PM2.5?',
    'PM2.5 क्या है?',
    'PM2.5 describes fine particulate matter. The app displays its concentration in micrograms per cubic metre (µg/m³), alongside PM10. These concentrations are not official Indian AQI.',
    'PM2.5 महीन कणों को दर्शाता है। ऐप इसकी सांद्रता माइक्रोग्राम प्रति घन मीटर (µg/m³) में PM10 के साथ दिखाता है। ये सांद्रताएं आधिकारिक भारतीय AQI नहीं हैं।',
  ],
  [
    'Why is there no station?',
    'स्टेशन क्यों नहीं दिखता?',
    'Providers may have no usable station within the bounded search, may need a key, or may lack verified metadata. A regional forecast can still support approximate planning. City search does not prove monitoring coverage.',
    'सीमित खोज में स्रोत के पास उपयोगी स्टेशन, कुंजी या सत्यापित जानकारी नहीं हो सकती। क्षेत्रीय पूर्वानुमान अनुमानित योजना में मदद कर सकता है। शहर का मिलना मॉनिटर कवरेज का प्रमाण नहीं है।',
  ],
  [
    'Can this show air at my school or street?',
    'क्या यह स्कूल या सड़क की हवा बताता है?',
    'No building measurement is inferred. CAMS Global uses roughly 45 km cells and three-hour source steps. Nearby monitors are separate observations; distance and timestamp matter.',
    'भवन का मापन अनुमानित नहीं किया जाता। CAMS Global लगभग 45 किमी और तीन घंटे के स्रोत अंतराल का उपयोग करता है। नज़दीकी मॉनिटर अलग अवलोकन हैं; दूरी और समय महत्वपूर्ण हैं।',
  ],
  [
    'How are times ranked?',
    'समय का क्रम कैसे तय होता है?',
    'Only complete future windows within your allowed range qualify. Lower PM2.5 peak ranks first, then the interval-weighted mean, then earlier time. Missing values are never treated as zero. A 15-minute search step is not 15-minute model accuracy.',
    'केवल उपलब्ध सीमा में पूरे डेटा वाले आगामी समय शामिल हैं। कम PM2.5 अधिकतम, फिर समय-भारित औसत, फिर पहले समय के अनुसार क्रम बनता है। खाली मान शून्य नहीं हैं। 15 मिनट का खोज अंतराल 15 मिनट की सटीकता नहीं है।',
  ],
  [
    'Does indoors mean clean air?',
    'क्या अंदर की हवा साफ है?',
    'An outdoor forecast cannot verify indoor conditions. Confirm a suitable indoor option each time. Indoor and cancelled decisions retain the outdoor comparison for provenance; they do not estimate exposure avoided.',
    'बाहरी पूर्वानुमान अंदर की स्थिति की पुष्टि नहीं करता। हर बार उपयुक्त अंदर के विकल्प की पुष्टि करें। अंदर और रद्द निर्णय बाहरी तुलना को संदर्भ के लिए रखते हैं; बचाए गए संपर्क का अनुमान नहीं है।',
  ],
  [
    'What does saved in this browser mean?',
    'इस ब्राउज़र में सहेजने का अर्थ?',
    'Your plan and local records stay on this browser origin until explicitly submitted to a workspace. localhost and 127.0.0.1 have separate storage. Export a backup before changing origins or clearing data. Session-only changes can disappear when you leave.',
    'योजना और स्थानीय रिकॉर्ड स्पष्ट रूप से कार्यस्थान में भेजने तक इसी ब्राउज़र मूल पर रहते हैं। localhost और 127.0.0.1 अलग संग्रह हैं। मूल बदलने या डेटा मिटाने से पहले बैकअप लें। केवल सत्र के बदलाव बंद करने पर खो सकते हैं।',
  ],
  [
    'Will alerts arrive when the tab is closed?',
    'टैब बंद होने पर संदेश आएंगे?',
    'The review inbox runs while the app is open. It does not send background email, SMS or push notifications. Optional workspace approval email is a separate configured service.',
    'समीक्षा संदेश ऐप खुला होने पर चलते हैं। यह पृष्ठभूमि ईमेल, SMS या पुश सूचना नहीं भेजता। वैकल्पिक कार्यस्थान अनुमोदन ईमेल अलग सेवा है।',
  ],
]
export default function HelpPanel({
  language,
  data,
}: {
  language: Language
  data: DashboardData | null
}) {
  const [query, setQuery] = useState(''),
    t = (en: string, hi: string) => say(language, en, hi)
  const matches = entries.filter((entry) =>
    entry
      .join(' ')
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  )
  return (
    <section className="card help-panel" aria-labelledby="help-title">
      <h2 id="help-title" tabIndex={-1}>
        {t('Help & how this works', 'सहायता और यह कैसे काम करता है')}
      </h2>
      <label className="field">
        {t('Search help', 'सहायता खोजें')}
        <input
          type="search"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Try “station” or “rule”', '“स्टेशन” या “सीमा” खोजें')}
        />
      </label>
      <p role="status" className="help-text">
        {matches.length} {t('help topics', 'सहायता विषय')}
      </p>
      {matches.map(([en, hi, answer, hindi]) => (
        <details key={en}>
          <summary>{t(en, hi)}</summary>
          <p>{t(answer, hindi)}</p>
        </details>
      ))}
      {!matches.length && (
        <p>
          {t(
            'No topic matched. Try a shorter term.',
            'कोई विषय नहीं मिला। छोटा शब्द खोजें।',
          )}
        </p>
      )}
      <details className="methodology">
        <summary>
          {t(
            'Sources, method & release status',
            'स्रोत, विधि और रिलीज़ की स्थिति',
          )}
        </summary>
        <dl>
          <div>
            <dt>{t('Forecast', 'पूर्वानुमान')}</dt>
            <dd>
              {data?.forecast?.source || 'Open-Meteo / CAMS Global'} ·{' '}
              {t(
                'regional concentrations, not Indian AQI',
                'क्षेत्रीय सांद्रता, भारतीय AQI नहीं',
              )}
            </dd>
          </div>
          <div>
            <dt>{t('Time meaning', 'समय का अर्थ')}</dt>
            <dd>
              {t(
                'Forecast retrieved is when the app obtained it, not the model issue time. A station timestamp is its observation time; last attempt and last success describe provider retrieval.',
                'पूर्वानुमान प्राप्त समय ऐप में डेटा मिलने का है, मॉडल जारी होने का नहीं। स्टेशन का समय उसके अवलोकन का है; अंतिम प्रयास और सफलता डेटा प्राप्ति बताते हैं।',
              )}
            </dd>
          </div>
          <div>
            <dt>{t('Official directions', 'आधिकारिक निर्देश')}</dt>
            <dd>
              {t(
                'Only reviewed applicable documents are listed. Your rule does not invoke GRAP or override school or local directions.',
                'केवल समीक्षा किए गए लागू दस्तावेज़ सूचीबद्ध हैं। आपकी सीमा GRAP लागू नहीं करती या स्कूल व स्थानीय निर्देशों को नहीं बदलती।',
              )}
            </dd>
          </div>
          <div>
            <dt>{t('Verified release status', 'सत्यापित रिलीज़ स्थिति')}</dt>
            <dd>
              {t(
                'Local implementation; cloud deployment, field accuracy and rendered usability still require verification. No safety score or certification is claimed.',
                'स्थानीय कार्यान्वयन; क्लाउड परिनियोजन, क्षेत्रीय सटीकता और उपयोगिता का सत्यापन बाकी है। कोई सुरक्षा स्कोर या प्रमाणपत्र दावा नहीं किया जाता।',
              )}
            </dd>
          </div>
        </dl>
        <div className="button-row">
          <a
            href="https://open-meteo.com/en/docs/air-quality-api"
            target="_blank"
            rel="noreferrer"
          >
            Open-Meteo / CAMS ↗
          </a>
          <a href="https://docs.openaq.org/" target="_blank" rel="noreferrer">
            OpenAQ ↗
          </a>
          <a href="https://caqm.nic.in/" target="_blank" rel="noreferrer">
            CAQM ↗
          </a>
        </div>
      </details>
    </section>
  )
}
