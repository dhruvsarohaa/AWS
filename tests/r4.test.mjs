import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addJourney,
  appendForegroundPoint,
  exportJourneyGpx,
  JOURNEY_LIMITS,
  journeyTimestamp,
  newForegroundJourney,
  parseLocalGpx,
  summarizeJourney,
  validateJourney,
  validateJourneyLibrary,
} from '../src/lib/r4-journeys.ts'
import { loadJourneyLibrary } from '../src/lib/r4-journey-store.ts'
import {
  compareReviewedRoutes,
  validateDenseAir,
  validateIndianPollen,
  validateWearableBatch,
} from '../api/r4-contracts.mjs'
import {
  deterministicExplanation,
  explainAssessment,
  r4Capabilities,
  r4Route,
  validateExplanationOutput,
} from '../api/r4-integrations.mjs'
import { MemoryStore } from '../api/store.mjs'

// Offline, synthetic contract tests only. No production provider, model, GPS or device calls.
const now = Date.parse('2026-10-10T06:00:00Z')
const iso = (delta = 0) => new Date(now + delta).toISOString()
const gpx = (
  body,
  attrs = 'version="1.1" creator="Offline test" xmlns="http://www.topografix.com/GPX/1/1"',
) => `<gpx ${attrs}><trk>${body}</trk></gpx>`
const point = (time = iso(-60000), lat = 28.6, lon = 77.2) =>
  `<trkpt lat="${lat}" lon="${lon}">${time === null ? '' : `<time>${time}</time>`}</trkpt>`
const parse = (xml) => parseLocalGpx(xml, 'Offline fixture', now)
const empty = { schemaVersion: 1, revision: 0, journeys: [] }

test('R4 GPX keeps zero coordinates, explicit UTC offsets, missing time and source provenance', () => {
  const track = parse(
    gpx(
      `<trkseg>${point('2026-10-10T11:29:00+05:30', 0, 0)}${point(null)}${point(iso())}</trkseg>`,
    ),
  )
  assert.equal(track.source, 'gpx_import')
  assert.equal(track.points[0].latitude, 0)
  assert.equal(track.points[0].longitude, 0)
  assert.equal(track.points[0].time, iso(-60000))
  assert.equal(track.points[1].time, null)
  assert.equal(track.points[1].accuracyMeters, null)
  assert.equal(summarizeJourney(track).exposure, null)
  assert.equal(summarizeJourney(track).missingTimePoints, 1)
  assert.equal(summarizeJourney(track).observedSeconds, 0)
})
test('R4 GPX continuous points remain one segment; reception gaps and explicit segments are not connected', () => {
  const track = parse(
    gpx(
      `<trkseg>${point(iso(-400000))}${point(iso(-350000), 28.601)}${point(iso(-50000), 28.61)}</trkseg><trkseg>${point(iso(), 28.611)}</trkseg>`,
    ),
  )
  assert.deepEqual(
    track.points.map((p) => p.segment),
    [0, 0, 1, 2],
  )
  const stats = summarizeJourney(track)
  assert.equal(stats.gaps, 2)
  assert.equal(stats.observedSeconds, 50)
  assert.ok(stats.metres > 100 && stats.metres < 120)
})
test('R4 GPX rejects entity expansion, DTD, XML instructions, malformed nesting and metadata-only files', () => {
  for (const xml of [
    `<!DOCTYPE gpx [<!ENTITY file SYSTEM "file:///private">]>${gpx(`<trkseg>${point()}</trkseg>`)}`,
    gpx(`<trkseg><trkpt lat="&private;" lon="77.2" /></trkseg>`),
    gpx(`<trkseg><trkpt lat="&AMP;" lon="77.2" /></trkseg>`),
    gpx(`<trkseg>${point()}</trkseg><?fetch url="https://invalid.example"?>`),
    gpx(`<trkseg>${point()}</wrong>`),
    gpx('<name>Only metadata</name>'),
    gpx(`<trkseg>${point()}</trkseg>`, 'version="1.1" creator="Fixture"'),
    gpx(
      `<trkseg>${point()}</trkseg>`,
      'version="1.0" creator="Fixture" xmlns="http://www.topografix.com/GPX/1/0"',
    ),
  ])
    assert.throws(() => parse(xml))
})
test('R4 GPX ignores external links and extension attributes without fetching or importing them', () => {
  const track = parse(
    gpx(
      `<link href="https://invalid.example/private"><text>Private metadata</text></link><trkseg>${point()}</trkseg><extensions><other xmlns="https://invalid.example">Untrusted instructions</other></extensions>`,
    ),
  )
  assert.equal(track.name, 'Offline fixture')
  assert.equal(track.points.length, 1)
  assert.equal(JSON.stringify(track).includes('invalid.example'), false)
  assert.equal(JSON.stringify(track).includes('Private metadata'), false)
})
test('R4 GPX bounds reject oversized, invalid coordinates, duplicate/reversed/future dates and too many points', () => {
  assert.throws(() => parse(' '.repeat(JOURNEY_LIMITS.bytes + 1)), /1 MB/)
  assert.throws(
    () => parse(gpx(`<trkseg>${point(iso(), 91)}</trkseg>`)),
    /coordinates/,
  )
  assert.throws(
    () => parse(gpx(`<trkseg>${point(iso())}${point(iso())}</trkseg>`)),
    /ordered/,
  )
  assert.throws(
    () => parse(gpx(`<trkseg>${point(iso(300001))}</trkseg>`)),
    /future/,
  )
  assert.throws(
    () => parse(gpx(`<trkseg>${point(iso(-367 * 86400000))}</trkseg>`)),
    /366 days/,
  )
  assert.throws(
    () =>
      parse(
        gpx(
          `<trkseg>${'<trkpt lat="1" lon="1"/>'.repeat(JOURNEY_LIMITS.points + 1)}</trkseg>`,
        ),
      ),
    /10,000/,
  )
  assert.equal(journeyTimestamp('2026-02-30T06:00:00Z'), null)
})
test('R4 GPX export escapes labels and preserves track gaps/time omissions on reimport', () => {
  const current = Date.now(),
    first = new Date(current - 60000).toISOString()
  const track = parseLocalGpx(
    gpx(`<trkseg>${point(first)}</trkseg><trkseg>${point(null)}</trkseg>`),
    '<script>&"journey',
    current,
  )
  const xml = exportJourneyGpx(track)
  assert.ok(xml.includes('&lt;script&gt;&amp;&quot;'))
  assert.equal(xml.includes('<script>'), false)
  const again = parseLocalGpx(xml, 'Again', current)
  assert.deepEqual(again.points, track.points)
})
test('R4 local duplicate imports, unknown schemas and collection bounds fail without replacing the library', () => {
  const track = parse(gpx(`<trkseg>${point()}</trkseg>`)),
    library = addJourney(empty, track, now)
  assert.throws(
    () => addJourney(library, { ...track, id: 'duplicate-track' }, now),
    /already/,
  )
  assert.equal(library.journeys.length, 1)
  assert.throws(
    () => validateJourneyLibrary({ ...library, schemaVersion: 90 }, now),
    /preserved|recovery/,
  )
  assert.throws(() =>
    validateJourneyLibrary(
      {
        ...library,
        journeys: Array.from({ length: 11 }, (_, i) => ({
          ...track,
          id: `track-${i}`,
        })),
      },
      now,
    ),
  )
})
test('R4 foreground points require recording, current accurate fixes and bounded ordered times', () => {
  const track = newForegroundJourney('Fixture', now)
  const sample = {
    latitude: 28.6,
    longitude: 77.2,
    time: iso(-60000),
    accuracyMeters: 0,
  }
  const first = appendForegroundPoint(track, sample, now)
  assert.equal(first.points[0].accuracyMeters, 0)
  assert.throws(
    () =>
      appendForegroundPoint(
        { ...first, status: 'interrupted' },
        { ...sample, time: iso() },
        now,
      ),
    /Start/,
  )
  assert.throws(() => appendForegroundPoint(first, sample, now), /ordered/)
  assert.throws(
    () =>
      appendForegroundPoint(track, { ...sample, accuracyMeters: 1001 }, now),
    /accuracy/,
  )
  assert.throws(
    () => appendForegroundPoint(track, { ...sample, time: iso(-120001) }, now),
    /recent/,
  )
  assert.throws(
    () =>
      validateJourney(
        {
          ...first,
          points: [
            ...first.points,
            { ...sample, time: iso(86400001), segment: 0 },
          ],
        },
        now + 86400001,
      ),
    /24 hours/,
  )
})
test('R4 missing IndexedDB is an explicit unsaved/recovery state', async () => {
  await assert.rejects(loadJourneyLibrary(), /unavailable/)
})

const assessment = {
  snapshotId: 'evidence_fixture',
  ruleVersion: 'custom-v1',
  evidenceState: 'current',
  threshold: 75,
  peak: 75,
  complete: true,
}
const model = {
  enabled: true,
  review: { modelAccess: true, region: true, cost: true, policy: true },
  run: async ({ assessment: minimal }) => ({
    snapshotId: minimal.snapshotId,
    state: minimal.state,
    phraseIds: [minimal.state, 'limit', 'indoor'],
    citationIds: [],
  }),
}
const member = { sub: 'user-fixture', workspaceId: 'workspace-fixture' }
test('R4 default external capabilities stay off, independently from local journeys', () => {
  assert.deepEqual(r4Capabilities(), {
    localJourneys: true,
    explanationAssistant: false,
    routeComparison: false,
    wearableSync: false,
    indianPollen: false,
    denseAirMap: false,
  })
  assert.equal(
    r4Capabilities({ explanation: { enabled: true } }).explanationAssistant,
    false,
  )
  assert.equal(
    r4Capabilities({ explanation: model }).explanationAssistant,
    true,
  )
  const unimplementedAdapter = {
    enabled: true,
    run() {},
    review: {
      license: true,
      coverage: true,
      quota: true,
      delhiPilot: true,
      platform: true,
      oauth: true,
      scopes: true,
      terms: true,
      indianCoverage: true,
      taxa: true,
      units: true,
      referenceEvaluation: true,
      uncertainty: true,
    },
  }
  const unsupported = r4Capabilities({
    routing: unimplementedAdapter,
    wearables: unimplementedAdapter,
    pollen: unimplementedAdapter,
    denseAir: unimplementedAdapter,
  })
  assert.equal(unsupported.routeComparison, false)
  assert.equal(unsupported.wearableSync, false)
  assert.equal(unsupported.indianPollen, false)
  assert.equal(unsupported.denseAirMap, false)
})
test('R4 deterministic explanation matches boundary, missing and stale evidence in either language', () => {
  assert.equal(deterministicExplanation(assessment).state, 'crossing')
  assert.equal(
    deterministicExplanation({ ...assessment, peak: 0 }).state,
    'below',
  )
  assert.equal(
    deterministicExplanation({ ...assessment, complete: false }).state,
    'missing',
  )
  assert.equal(
    deterministicExplanation({ ...assessment, evidenceState: 'stale' }).state,
    'stale',
  )
  assert.ok(
    deterministicExplanation(assessment, 'hi').lines[0].includes('समीक्षा'),
  )
  assert.throws(() => deterministicExplanation({ ...assessment, peak: NaN }))
})
test('R4 assisted output cannot change rules, introduce prose/actions or invent citations', () => {
  const valid = {
    snapshotId: assessment.snapshotId,
    state: 'crossing',
    phraseIds: ['crossing', 'indoor', 'limit'],
    citationIds: ['policy'],
  }
  const sources = [{ id: 'policy' }]
  assert.equal(
    validateExplanationOutput(valid, assessment, sources).mode,
    'assisted',
  )
  for (const output of [
    { ...valid, state: 'below' },
    { ...valid, snapshotId: 'other' },
    { ...valid, action: 'close_school' },
    { ...valid, citationIds: ['invented_order'] },
    { ...valid, phraseIds: ['crossing', 'indoor', 'safe_air'] },
  ])
    assert.throws(() => validateExplanationOutput(output, assessment, sources))
})
test('R4 explicit-use gate and failure/timeout/quota always retain deterministic guidance', async () => {
  const store = new MemoryStore()
  assert.equal(
    (await explainAssessment(assessment, { member, store, adapter: model }))
      .reason,
    'assistant_unavailable',
  )
  assert.equal(
    (
      await explainAssessment(assessment, {
        explicitUse: true,
        member,
        store,
        adapter: {
          ...model,
          run: () => {
            throw new Error('outage')
          },
        },
      })
    ).reason,
    'provider_or_contract_failure',
  )
  assert.equal(
    (
      await explainAssessment(assessment, {
        explicitUse: true,
        member,
        store,
        adapter: { ...model, run: () => new Promise(() => {}) },
        timeoutMs: 10,
      })
    ).reason,
    'timeout',
  )
  assert.equal(
    (
      await explainAssessment(assessment, {
        explicitUse: true,
        member,
        store,
        adapter: model,
      })
    ).mode,
    'assisted',
  )
  assert.equal(
    (
      await explainAssessment(assessment, {
        explicitUse: true,
        member,
        store,
        adapter: model,
      })
    ).reason,
    'quota',
  )
})
test('R4 model receives only minimized computed facts; offset source review times compare as instants', async () => {
  let payload
  const result = await explainAssessment(
    {
      ...assessment,
      exactLocation: 'private',
      reason: '<script>private</script>',
    },
    {
      explicitUse: true,
      member,
      store: new MemoryStore(),
      now,
      sources: [
        {
          id: 'source1',
          excerpt: 'Reviewed source data',
          reviewedAt: '2026-10-10T11:29:00+05:30',
        },
      ],
      adapter: {
        ...model,
        run: async (input) => {
          payload = input
          return {
            snapshotId: input.assessment.snapshotId,
            state: input.assessment.state,
            phraseIds: [input.assessment.state, 'limit', 'indoor'],
            citationIds: ['source1'],
          }
        },
      },
    },
  )
  assert.equal(result.mode, 'assisted')
  assert.equal(payload.sources.length, 1)
  assert.equal(JSON.stringify(payload).includes('private'), false)
  assert.equal(Object.hasOwn(payload.assessment, 'complete'), false)
})
test('R4 explanation route never accepts client assessment or starts an unavailable model', async () => {
  const body = {
    snapshotId: assessment.snapshotId,
    activityId: 'activity-fixture',
    language: 'en',
    explicitUse: true,
  }
  const store = new MemoryStore(),
    path = '/api/workspace/integrations/explanations'
  assert.equal(
    (await r4Route('POST', path, body, member, store)).reason,
    'trusted_assessment_unavailable',
  )
  await assert.rejects(
    r4Route('POST', path, { ...body, assessment }, member, store),
    /snapshot\/activity/,
  )
  await assert.rejects(r4Route('POST', path, body, null, store), /Sign in/)
  await assert.rejects(
    r4Route('POST', path, body, member, store, {
      resolveAssessment: async () => ({
        assessment: { ...assessment, snapshotId: 'other' },
      }),
    }),
    /no longer/,
  )
  await assert.rejects(
    r4Route('GET', '/api/workspace/integrations/pollen', {}, member, store),
    (error) => error.status === 503 && error.code === 'integration_gate_closed',
  )
})

const routeReview = {
  license: true,
  delhiPilot: true,
  maxResolutionMeters: 500,
  evaluationId: 'synthetic-evaluation',
}
const routeFixture = () => ({
  departureAt: iso(60000),
  mode: 'walk',
  routingProvider: 'fixture-routing',
  routeAttribution: 'Synthetic route fixture',
  air: {
    schemaVersion: 1,
    provider: 'fixture-fine-air',
    attribution: 'Synthetic evidence fixture',
    licenseReference: 'fixture-only',
    kind: 'model',
    production: true,
    retrievedAt: iso(),
    resolutionMeters: 100,
    pollutant: 'pm25',
    unit: 'µg/m³',
    statistic: 'segment_mean',
    modelId: 'fixture-grid',
    maxAgeMinutes: 60,
  },
  routes: [10, 50].map((value, i) => ({
    id: `route-${i}`,
    permitted: true,
    departureAt: iso(60000),
    mode: 'walk',
    durationSeconds: 600,
    distanceMeters: 500,
    geometry: [
      [77.2, 28.6],
      [77.201 + i / 100, 28.601],
    ],
    segments: [
      {
        seconds: 600,
        cellId: `cell-${i}`,
        value,
        uncertainty: 1,
        validFrom: iso(),
        validTo: iso(3600000),
      },
    ],
  })),
})
test('R4 route ranking requires legal routes and complete resolving evidence with separated uncertainty', () => {
  const result = compareReviewedRoutes(routeFixture(), routeReview, now)
  assert.equal(result.status, 'ranked_model_comparison')
  assert.deepEqual(result.ranking, ['route-0', 'route-1'])
  assert.equal(result.routes[0].estimate, 10 / 6)
  const zero = routeFixture()
  zero.routes[0].segments[0].value = 0
  assert.equal(
    compareReviewedRoutes(zero, routeReview, now).routes[0].estimate,
    0,
  )
})
test('R4 coarse, missing, stale, shared cells and unresolved uncertainty only show travel alternatives', () => {
  const cases = [
    [
      'unresolved_spatial_resolution',
      (v) => {
        v.air.resolutionMeters = 45000
      },
    ],
    [
      'no_compatible_air',
      (v) => {
        delete v.air
      },
    ],
    [
      'stale_air',
      (v) => {
        v.air.retrievedAt = iso(-61 * 60000)
      },
    ],
    [
      'missing_segments',
      (v) => {
        v.routes[0].segments[0].value = null
      },
    ],
    [
      'shared_unresolved_cells',
      (v) => {
        v.routes[1].segments[0].cellId = 'cell-0'
      },
    ],
    [
      'overlapping_uncertainty',
      (v) => {
        v.routes[1].segments[0].uncertainty = 49
      },
    ],
  ]
  for (const [reason, mutate] of cases) {
    const raw = routeFixture()
    mutate(raw)
    const result = compareReviewedRoutes(raw, routeReview, now)
    assert.equal(result.reason, reason)
    assert.equal(result.ranking, null)
  }
})
test('R4 route contracts reject illegal/unmatched traversal, incompatible units, samples and excess alternatives', () => {
  for (const mutate of [
    (v) => {
      v.routes[0].permitted = false
    },
    (v) => {
      v.routes[0].segments[0].seconds = 599
    },
    (v) => {
      v.air.unit = 'AQI'
    },
    (v) => {
      v.air.production = false
    },
    (v) => {
      v.routes.push(v.routes[0], v.routes[0])
    },
  ]) {
    const raw = routeFixture()
    mutate(raw)
    assert.throws(() => compareReviewedRoutes(raw, routeReview, now))
  }
  assert.throws(() =>
    compareReviewedRoutes(
      routeFixture(),
      { ...routeReview, delhiPilot: false },
      now,
    ),
  )
})
test('R4 offset-equivalent departures/intervals compare chronologically and reversed instants fail', () => {
  const raw = routeFixture()
  raw.routes[0].departureAt = '2026-10-10T11:31:00+05:30'
  raw.routes[0].segments[0].validFrom = '2026-10-10T11:30:00+05:30'
  raw.routes[0].segments[0].validTo = '2026-10-10T07:00:00Z'
  assert.equal(
    compareReviewedRoutes(raw, routeReview, now).status,
    'ranked_model_comparison',
  )
  raw.routes[0].segments[0].validTo = '2026-10-10T06:29:00+01:00'
  assert.throws(() => compareReviewedRoutes(raw, routeReview, now))
})

const pollenReview = {
  license: true,
  indianCoverage: true,
  taxa: true,
  units: true,
}
const place = { latitude: 28.6, longitude: 77.2 }
const pollen = () => ({
  schemaVersion: 1,
  provider: 'fixture-pollen',
  country: 'IN',
  attribution: 'Synthetic test only',
  licenseReference: 'fixture-only',
  production: true,
  retrievedAt: iso(),
  maxAgeMinutes: 180,
  bounds: [77, 28, 78, 29],
  points: [
    {
      taxon: 'grass',
      unit: 'grains/m³',
      statistic: 'interval_mean',
      start: iso(),
      end: iso(3600000),
      value: 0,
    },
  ],
})
test('R4 Indian pollen retains zero and null, outside coverage and stale states without diagnosis', () => {
  const raw = pollen()
  raw.points.push({
    ...raw.points[0],
    start: iso(3600000),
    end: iso(7200000),
    value: null,
  })
  const result = validateIndianPollen(raw, pollenReview, place, now)
  assert.deepEqual(
    result.points.map((p) => p.value),
    [0, null],
  )
  assert.equal(result.status, 'available')
  assert.equal(
    validateIndianPollen(
      raw,
      pollenReview,
      { latitude: 18, longitude: 73 },
      now,
    ).status,
    'no_coverage',
  )
  raw.retrievedAt = iso(-181 * 60000)
  assert.equal(
    validateIndianPollen(raw, pollenReview, place, now).status,
    'stale',
  )
})
test('R4 pollen rejects European coverage, unsupported unit/taxa/overlaps and unreviewed feed', () => {
  for (const mutate of [
    (v) => {
      v.country = 'EU'
    },
    (v) => {
      v.points[0].unit = 'µg/m³'
    },
    (v) => {
      v.points[0].taxon = ''
    },
    (v) => {
      v.points.push(v.points[0])
    },
  ]) {
    const raw = pollen()
    mutate(raw)
    assert.throws(() => validateIndianPollen(raw, pollenReview, place, now))
  }
  assert.throws(() =>
    validateIndianPollen(
      pollen(),
      { ...pollenReview, indianCoverage: false },
      place,
      now,
    ),
  )
})
test('R4 dense cell maps require independent evaluation and never interpolate or attribute sources', () => {
  const raw = {
    ...routeFixture().air,
    statistic: 'interval_mean',
    validFrom: iso(),
    validTo: iso(3600000),
    cells: [0, 1, 2].map((i) => ({
      id: `cell-${i}`,
      latitude: 28.6 + i / 100,
      longitude: 77.2,
      value: i === 2 ? null : i,
      uncertainty: 10,
    })),
  }
  const review = {
    license: true,
    coverage: true,
    referenceEvaluation: true,
    uncertainty: true,
    evaluationId: 'fixture-eval',
    archiveId: 'fixture-archive',
    maxResolutionMeters: 500,
    independentReferences: 3,
  }
  const result = validateDenseAir(raw, review, now)
  assert.equal(result.rendering, 'validated_cells_only')
  assert.equal(result.sourceAttribution, false)
  assert.equal(result.cells[0].value, 0)
  assert.throws(() =>
    validateDenseAir(raw, { ...review, independentReferences: 2 }, now),
  )
  assert.throws(() =>
    validateDenseAir({ ...raw, resolutionMeters: 45000 }, review, now),
  )
  assert.throws(() =>
    validateDenseAir({ ...raw, cells: raw.cells.slice(0, 2) }, review, now),
  )
})
test('R4 wearable batches minimize imported fields, deduplicate activity IDs and reject revoked/expired/wide scopes', () => {
  const connection = {
    platform: 'fixture-platform',
    accountId: 'fixture-account',
    consent: true,
    revoked: false,
    expiresAt: iso(3600000),
    scopes: ['activity:read'],
  }
  const activity = {
    id: 'workout-fixture',
    startedAt: iso(-3600000),
    endedAt: iso(-1800000),
    kind: 'walk',
    heartRate: 'private',
    route: 'private',
  }
  const raw = {
      platform: 'fixture-platform',
      activities: [activity, activity],
    },
    result = validateWearableBatch(raw, connection, now)
  assert.equal(result.activities.length, 1)
  assert.equal(result.duplicateCount, 1)
  assert.equal(JSON.stringify(result).includes('private'), false)
  for (const changed of [
    { revoked: true },
    { consent: false },
    { expiresAt: iso() },
    { scopes: ['activity:read', 'health:read'] },
  ])
    assert.throws(() =>
      validateWearableBatch(raw, { ...connection, ...changed }, now),
    )
})
