/**
 * Fitting catalog labels into wheel segments.
 *
 * Labels run radially along the centre line of each segment, so a label has
 * two budgets: the radial band gives it length, and the arc width at the
 * innermost point the text occupies gives it height (and therefore font size).
 * Both shrink as the segment count grows, which is why wheel 2 truncates.
 */

/**
 * Starting guess for glyph advance as a fraction of font size. The system
 * font stack means real metrics vary by device, so Wheel.jsx measures what it
 * actually drew and feeds a corrected value back in as `charWidth`.
 */
export const DEFAULT_CHAR_W = 0.55

/**
 * Font size that fits `count` segments without labels colliding, given the
 * radius at which the text begins.
 */
export function fitFontSize({ count, textStartR, lines, min = 1.7, max = 3.4 }) {
  const arc = (2 * Math.PI * textStartR) / count
  // 0.72 leaves visible air between neighbouring labels where they are
  // closest, and buys a couple more characters before truncation bites.
  const perLine = (arc * 0.72) / lines
  return Math.max(min, Math.min(max, perLine))
}

/** Truncate to `maxChars`, breaking on a word boundary where one is close by. */
export function truncate(text, maxChars) {
  if (text.length <= maxChars) return text
  if (maxChars <= 1) return '…'
  const cut = text.slice(0, maxChars - 1)
  const space = cut.lastIndexOf(' ')
  const base = space > maxChars * 0.6 ? cut.slice(0, space) : cut.trimEnd()
  return base + '…'
}

/**
 * Splits onto two lines at the word break that makes the two lines as even as
 * possible — greedy filling would leave "Calling and / Costly Obedience", which
 * overflows the second line while the first sits half empty.
 */
export function wrapLabel(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 2) return [truncate(text, maxChars)]

  let best = null
  for (let k = 1; k < words.length; k++) {
    const first = words.slice(0, k).join(' ')
    const second = words.slice(k).join(' ')
    const longest = Math.max(first.length, second.length)
    const overflow = Math.max(0, first.length - maxChars) + Math.max(0, second.length - maxChars)
    // Fit first, evenness second.
    const score = overflow * 1000 + longest
    if (!best || score < best.score) best = { score, lines: [first, second] }
  }
  return best.lines.map((l) => truncate(l, maxChars))
}

/**
 * Complete label layout for a wheel: font size, line count and per-line text.
 * `bandLength` is the radial distance available to the text.
 */
export function layoutLabels({ labels, count, textStartR, bandLength, maxLines = 1, charWidth = DEFAULT_CHAR_W }) {
  const lines = count <= 16 && maxLines > 1 ? 2 : 1
  const fontSize = fitFontSize({ count, textStartR, lines })
  const maxChars = Math.max(4, Math.floor(bandLength / (charWidth * fontSize)))
  return {
    fontSize,
    lines,
    maxChars,
    // Only wrap onto a second line when the label actually needs one.
    rows: labels.map((t) => (lines > 1 && t.length > maxChars ? wrapLabel(t, maxChars) : [truncate(t, maxChars)])),
  }
}
