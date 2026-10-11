import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const theme = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const token = (name) => {
  const result = theme.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`, 'i'))
  assert.ok(result, `Color token ${name} exists`)
  return result[1]
}
const luminance = (hex) =>
  hex
    .match(/[a-f0-9]{2}/gi)
    .map((part) => parseInt(part, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    )
    .reduce(
      (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
      0,
    )
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test('the shared text palette meets normal-text contrast on its declared backgrounds', () => {
  for (const [foreground, background] of [
    ['ink', 'paper'],
    ['muted', 'paper'],
    ['muted', 'canvas'],
    ['forest', 'paper'],
    ['danger', 'paper'],
    ['warning-ink', 'warning-paper'],
  ]) {
    assert.ok(
      contrast(token(foreground), token(background)) >= 4.5,
      `${foreground} against ${background} must meet 4.5:1`,
    )
  }
})
