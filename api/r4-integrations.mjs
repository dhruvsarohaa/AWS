import { ApiError, hash, timestamp } from './core.mjs'

// Capability claims require an installed adapter plus a reviewed deployment contract.
// Environment switches alone cannot establish provider rights, coverage or validation.
export function r4Capabilities(adapters = {}) {
  const ready = (name, gates) =>
    Boolean(
      adapters[name]?.enabled === true &&
      typeof adapters[name]?.run === 'function' &&
      gates.every((gate) => adapters[name]?.review?.[gate] === true),
    )
  return {
    localJourneys: true,
    explanationAssistant: ready('explanation', [
      'modelAccess',
      'region',
      'cost',
      'policy',
    ]),
    // These contracts have no installed network dispatch yet. Reviewed metadata alone
    // cannot advertise a working endpoint; a selected adapter remains future work.
    routeComparison: false,
    wearableSync: false,
    indianPollen: false,
    denseAirMap: false,
  }
}

const PHRASES = {
  missing: [
    'The reviewed window has incomplete evidence; compare times only after usable evidence is available.',
    'समीक्षित समय का डेटा अधूरा है; उपयोगी डेटा मिलने पर ही समयों की तुलना करें।',
  ],
  stale: [
    'The retained evidence is old; refresh and review again before using a timing comparison.',
    'सहेजा डेटा पुराना है; समय की तुलना से पहले रीफ़्रेश करके फिर समीक्षा करें।',
  ],
  crossing: [
    'The computed PM2.5 peak reaches your planning threshold; review the activity and feasible alternatives.',
    'गणना किया गया PM2.5 शिखर आपकी योजना सीमा तक पहुँचता है; गतिविधि और उपलब्ध विकल्पों की समीक्षा करें।',
  ],
  below: [
    'The computed PM2.5 peak is below your planning threshold; this does not establish safe air.',
    'गणना किया गया PM2.5 शिखर आपकी योजना सीमा से कम है; यह सुरक्षित हवा का प्रमाण नहीं है।',
  ],
  limit: [
    'This explains a user-set planning rule, not an official order or a medical conclusion.',
    'यह उपयोगकर्ता की योजना सीमा समझाता है; आधिकारिक आदेश या चिकित्सा निष्कर्ष नहीं है।',
  ],
  indoor: [
    'Outdoor evidence cannot verify indoor air; confirm each indoor alternative separately.',
    'बाहरी डेटा अंदर की हवा नहीं बताता; हर अंदर के विकल्प की अलग पुष्टि करें।',
  ],
}

function minimalAssessment(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(value.snapshotId || '') ||
    !/^[a-zA-Z0-9_.-]{1,80}$/.test(value.ruleVersion || '') ||
    !['current', 'stale', 'missing'].includes(value.evidenceState) ||
    !Number.isFinite(value.threshold) ||
    value.threshold < 1 ||
    value.threshold > 1000 ||
    !(
      value.peak === null ||
      (Number.isFinite(value.peak) && value.peak >= 0 && value.peak <= 10000)
    ) ||
    typeof value.complete !== 'boolean'
  )
    throw new ApiError('Explanation assessment is invalid.')
  const state =
    !value.complete || value.peak === null || value.evidenceState === 'missing'
      ? 'missing'
      : value.evidenceState === 'stale'
        ? 'stale'
        : value.peak >= value.threshold
          ? 'crossing'
          : 'below'
  return {
    snapshotId: value.snapshotId,
    ruleVersion: value.ruleVersion,
    threshold: value.threshold,
    peak: value.peak,
    state,
  }
}

export function deterministicExplanation(
  assessment,
  language = 'en',
  reason = 'template',
) {
  const clean = minimalAssessment(assessment)
  return {
    schemaVersion: 1,
    mode: 'deterministic',
    reason,
    ...clean,
    language: language === 'hi' ? 'hi' : 'en',
    phraseIds: [clean.state, 'limit', 'indoor'],
    citationIds: [],
    lines: [clean.state, 'limit', 'indoor'].map(
      (id) => PHRASES[id][language === 'hi' ? 1 : 0],
    ),
  }
}

export function validateExplanationOutput(
  output,
  assessment,
  sources,
  language = 'en',
) {
  const fallback = deterministicExplanation(assessment, language)
  if (
    !output ||
    typeof output !== 'object' ||
    Array.isArray(output) ||
    Object.keys(output).some(
      (key) =>
        !['snapshotId', 'state', 'phraseIds', 'citationIds'].includes(key),
    ) ||
    output.snapshotId !== fallback.snapshotId ||
    output.state !== fallback.state ||
    !Array.isArray(output.phraseIds) ||
    output.phraseIds.length !== 3 ||
    new Set(output.phraseIds).size !== 3 ||
    output.phraseIds.some((id) => !fallback.phraseIds.includes(id)) ||
    !Array.isArray(output.citationIds) ||
    output.citationIds.length > 4 ||
    new Set(output.citationIds).size !== output.citationIds.length ||
    output.citationIds.some((id) => !sources.some((source) => source.id === id))
  )
    throw new ApiError(
      'Generated explanation failed the grounded output contract.',
    )
  return {
    ...fallback,
    mode: 'assisted',
    reason: 'validated',
    phraseIds: [...output.phraseIds],
    citationIds: [...output.citationIds],
    lines: output.phraseIds.map((id) => PHRASES[id][language === 'hi' ? 1 : 0]),
  }
}

export async function explainAssessment(
  assessment,
  {
    language = 'en',
    explicitUse = false,
    member,
    store,
    adapter,
    sources = [],
    now = Date.now(),
    timeoutMs = 5000,
  } = {},
) {
  const fallback = (reason) =>
    deterministicExplanation(assessment, language, reason)
  if (
    !explicitUse ||
    !r4Capabilities({ explanation: adapter }).explanationAssistant
  )
    return fallback('assistant_unavailable')
  if (!member?.sub || !store) return fallback('sign_in_required')
  const reviewedSources = sources
    .slice(0, 4)
    .filter(
      (source) =>
        source &&
        /^[a-zA-Z0-9_-]{1,60}$/.test(source.id || '') &&
        typeof source.excerpt === 'string' &&
        source.excerpt.length <= 600 &&
        timestamp(source.reviewedAt) &&
        Date.parse(source.reviewedAt) <= now,
    )
    .map(({ id, excerpt, reviewedAt }) => ({ id, excerpt, reviewedAt }))
  const clean = minimalAssessment(assessment)
  const day = new Date(now).toISOString().slice(0, 10),
    expires = Math.floor(now / 1000) + 2 * 86400
  try {
    if (
      !(await store.increment(`R4AI#GLOBAL#${day}`, 20, expires)) ||
      !(await store.increment(
        `R4AI#USER#${hash(member.sub)}#${day}`,
        3,
        expires,
      ))
    )
      return fallback('quota')
  } catch {
    return fallback('quota_storage_unavailable')
  }
  const controller = new AbortController()
  let timer
  try {
    const output = await Promise.race([
      Promise.resolve().then(() =>
        adapter.run(
          {
            assessment: clean,
            allowedPhraseIds: [clean.state, 'limit', 'indoor'],
            sources: reviewedSources,
            language: language === 'hi' ? 'hi' : 'en',
          },
          controller.signal,
        ),
      ),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => {
            controller.abort()
            reject(new Error('timeout'))
          },
          Math.min(5000, Math.max(10, timeoutMs)),
        )
      }),
    ])
    return validateExplanationOutput(
      output,
      assessment,
      reviewedSources,
      language,
    )
  } catch {
    return fallback(
      controller.signal.aborted ? 'timeout' : 'provider_or_contract_failure',
    )
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

/** Authenticated route boundary. The trusted resolver is server-owned and never accepts an assessment from a client. */
export async function r4Route(method, path, body, member, store, options = {}) {
  if (!member?.sub || !member?.workspaceId)
    throw new ApiError('Sign in with current membership.', 401)
  if (method === 'GET' && path === '/api/workspace/integrations/status')
    return {
      schemaVersion: 1,
      capabilities: r4Capabilities(options.adapters),
      gates: {
        explanation: 'Selected model, region, budget and policy review',
        routing: 'Licensed route adapter and evaluated Delhi corridor',
        wearables: 'Selected platform and approved narrow OAuth scopes',
        pollen: 'Licensed Indian taxa and geographic/time coverage',
        denseAir: 'Real reference evaluation, density and uncertainty',
      },
    }
  if (
    path === '/api/workspace/integrations/explanations' &&
    method === 'POST'
  ) {
    if (
      !body ||
      body.explicitUse !== true ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(body.snapshotId || '') ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(body.activityId || '') ||
      !['en', 'hi'].includes(body.language)
    )
      throw new ApiError(
        'Choose an activity and explicitly request its explanation.',
      )
    if (
      Object.keys(body).some(
        (key) =>
          !['snapshotId', 'activityId', 'language', 'explicitUse'].includes(
            key,
          ),
      )
    )
      throw new ApiError('Only a snapshot/activity reference may be submitted.')
    if (typeof options.resolveAssessment !== 'function')
      return {
        schemaVersion: 1,
        mode: 'unavailable',
        reason: 'trusted_assessment_unavailable',
        lines: [
          body.language === 'hi'
            ? 'मौजूदा नियम-आधारित मार्गदर्शन का उपयोग करें।'
            : 'Use the existing rule-based guidance.',
        ],
      }
    const resolved = await options.resolveAssessment(
      { snapshotId: body.snapshotId, activityId: body.activityId },
      member,
    )
    if (resolved?.assessment?.snapshotId !== body.snapshotId)
      throw new ApiError('Evidence snapshot is no longer available.', 409)
    return explainAssessment(resolved.assessment, {
      language: body.language,
      explicitUse: true,
      member,
      store,
      adapter: options.adapters?.explanation,
      sources: resolved.sources,
    })
  }
  if (
    [
      '/api/workspace/integrations/routes',
      '/api/workspace/integrations/wearables',
      '/api/workspace/integrations/pollen',
      '/api/workspace/integrations/dense-air',
    ].includes(path)
  )
    throw new ApiError(
      'This integration needs a selected, reviewed provider and field pilot before activation.',
      503,
      'integration_gate_closed',
    )
  throw new ApiError('Integration route does not exist.', 404)
}
