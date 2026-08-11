#!/usr/bin/env node
/**
 * Inlines the production build into one self-contained HTML file.
 *
 * Used for previews and for any host that will not serve sibling assets: the
 * CSS and JS are inlined, so the page has no external requests at all. Fonts
 * are already system stacks and the wheel is drawn in SVG, so nothing else
 * needs embedding.
 *
 * Run: npm run build && node scripts/build-single-file.mjs [outfile]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const dist = resolve(root, 'dist')
const out = process.argv[2] ?? resolve(root, 'dist', 'spin-catalog.html')

const assets = readdirSync(resolve(dist, 'assets'))
const cssFile = assets.find((f) => f.endsWith('.css'))
const jsFiles = assets.filter((f) => f.endsWith('.js'))

if (!cssFile) throw new Error('no CSS bundle in dist/assets')
if (jsFiles.length !== 1) throw new Error(`expected exactly one JS bundle, found ${jsFiles.length}: ${jsFiles}`)

const css = readFileSync(resolve(dist, 'assets', cssFile), 'utf8')
const js = readFileSync(resolve(dist, 'assets', jsFiles[0]), 'utf8')

// Carry over any inline <script> from the built index.html — the appearance
// bootstrap lives there because it has to run before first paint, and pulling
// it out of the build rather than restating it keeps the two in step.
const indexHtml = readFileSync(resolve(dist, 'index.html'), 'utf8')
const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1].trim())
  .filter(Boolean)

// A literal </script> anywhere in the bundle would close the tag early.
const safeJs = js.replace(/<\/script/gi, '<\\/script')

// The charset must be declared in the document itself: a host that serves the
// file without one leaves the browser to guess, and every em dash and curly
// quote in the catalog turns to mojibake.
const html = `<meta charset="utf-8">
<title>The Spin Catalog</title>
<style>
${css}
</style>
${inlineScripts.map((s) => `<script>\n${s}\n</script>`).join('\n')}
<div id="root"></div>
<script type="module">
${safeJs}
</script>
`

writeFileSync(out, html)

const kb = (n) => `${(n / 1024).toFixed(1)} kB`
console.log(`\nwrote ${out}`)
console.log(`  css            ${kb(css.length)}`)
console.log(`  js             ${kb(js.length)}`)
console.log(`  inline scripts ${inlineScripts.length} carried from index.html`)
console.log(`  total          ${kb(html.length)}`)
console.log(`  external requests: 0\n`)
