#!/usr/bin/env node
/**
 * Guards vercel.json against the mistake that already cost one failed deploy:
 * Vercel validates the file strictly and rejects any property it does not
 * recognise, so a helpful-looking "comment" key fails the build rather than
 * being ignored. JSON has nowhere to put a note, which is exactly why the
 * temptation exists — the explanations live in DEPLOY.md instead.
 *
 * This only checks the properties we actually use. It is a tripwire, not a
 * reimplementation of Vercel's schema.
 *
 * Run: node scripts/check-vercel-config.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

let config
try {
  config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'))
} catch (e) {
  console.error(`✗ vercel.json is unreadable: ${e.message}`)
  process.exit(1)
}

const TOP = new Set([
  '$schema', 'framework', 'buildCommand', 'installCommand', 'devCommand',
  'outputDirectory', 'rewrites', 'redirects', 'headers', 'cleanUrls',
  'trailingSlash', 'regions', 'functions', 'crons', 'images', 'git',
])
const check = (obj, allowed, where) => {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) problems.push(`${where}: unknown property "${key}"`)
  }
}

check(config, TOP, 'vercel.json')

for (const [i, r] of (config.rewrites ?? []).entries()) {
  check(r, new Set(['source', 'destination', 'has', 'missing']), `rewrites[${i}]`)
  if (!r.source || !r.destination) problems.push(`rewrites[${i}]: needs both source and destination`)
}

for (const [i, h] of (config.headers ?? []).entries()) {
  check(h, new Set(['source', 'headers', 'has', 'missing']), `headers[${i}]`)
  if (!Array.isArray(h.headers)) problems.push(`headers[${i}]: "headers" must be an array`)
  for (const [j, entry] of (h.headers ?? []).entries()) {
    check(entry, new Set(['key', 'value']), `headers[${i}].headers[${j}]`)
    if (!entry.key || typeof entry.value !== 'string') {
      problems.push(`headers[${i}].headers[${j}]: needs a key and a string value`)
    }
  }
}

// The SPA rewrite is what keeps a refresh or a deep link from 404ing.
const spa = (config.rewrites ?? []).some((r) => r.destination === '/index.html')
if (!spa) problems.push('no rewrite to /index.html — a refresh or a deep link would 404')

// The app must be allowed to reach its own backend.
const csp = (config.headers ?? [])
  .flatMap((h) => h.headers ?? [])
  .find((e) => e.key === 'Content-Security-Policy')
if (csp && !/connect-src[^;]*supabase\.co/.test(csp.value)) {
  problems.push('the CSP blocks Supabase — connect-src must allow https://*.supabase.co')
}
if (csp && !/connect-src[^;]*wss:\/\/\*\.supabase\.co/.test(csp.value)) {
  problems.push('the CSP blocks realtime — connect-src must allow wss://*.supabase.co')
}

if (problems.length) {
  console.error(`\n✗ vercel.json has ${problems.length} problem(s):`)
  for (const p of problems) console.error(`   ${p}`)
  console.error('')
  process.exit(1)
}
console.log('✓ vercel.json is valid\n')
