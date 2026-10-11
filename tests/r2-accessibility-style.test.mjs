import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Static style regressions; these do not establish reflow, keyboard or screen-reader behavior.
const css = readFileSync(
  new URL('../src/App.css', import.meta.url),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
const declarations = (selector) =>
  rules
    .filter(([, selectors]) =>
      selectors
        .trim()
        .split(',')
        .map((s) => s.trim())
        .includes(selector),
    )
    .map(([, , styles]) => styles)
    .join('\n')
const luminance = (hex) =>
  hex
    .match(/[a-f0-9]{2}/gi)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)

test('R2 native form controls retain44px height,16px text and a contrasting boundary', () => {
  for (const selector of [
    '.r2-form-row input',
    '.r2-form-row select',
    '.suggestion-feedback textarea',
    '.context-favorites select',
  ]) {
    const styles = declarations(selector)
    assert.match(styles, /min-height:\s*44px/)
    assert.match(styles, /font-size:\s*1rem/)
    const border = styles.match(/border:\s*1px solid (#[a-f0-9]{6})/i)?.[1]
    assert.ok(border)
    assert.ok(1.05 / (luminance(border) + 0.05) >= 3)
    assert.match(styles, /min-width:\s*0/)
    assert.match(styles, /max-width:\s*100%/)
  }
})
test('R2 flexible fields and private/free-text panels declare bounded wrapping rather than widening the page', () => {
  assert.match(declarations('.r2-form-row > *'), /min-width:\s*0/)
  for (const selector of [
    '.favorite-places',
    '.personal-progress',
    '.suggestion-feedback',
    '.history-trends',
  ])
    assert.match(declarations(selector), /overflow-wrap:\s*anywhere/)
  assert.match(declarations('.favorites-list .button'), /min-width:\s*0/)
  assert.match(declarations('.recap-grid article'), /min-width:\s*0/)
})
test('R2 map controls retain44px close target and24px attribution link target without hiding attribution', () => {
  assert.match(
    declarations('.station-map .leaflet-popup-close-button'),
    /min-width:\s*44px/,
  )
  assert.match(
    declarations('.station-map .leaflet-popup-close-button'),
    /min-height:\s*44px/,
  )
  assert.match(
    declarations('.station-map .leaflet-control-attribution a'),
    /min-height:\s*24px/,
  )
  assert.doesNotMatch(
    declarations('.station-map .leaflet-control-attribution'),
    /display:\s*none/,
  )
  assert.match(
    declarations('.station-map .leaflet-popup-content'),
    /max-width:\s*calc\(100vw - 140px\)/,
  )
})
test('R2 optional map transitions respect reduced-motion preference', () => {
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]+\.station-map[\s\S]*?transition:\s*none !important/,
  )
})
