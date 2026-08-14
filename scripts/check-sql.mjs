/**
 * Applies the Supabase migrations to a throwaway Postgres and checks they do
 * what they claim.
 *
 * The project itself is unreachable from this build environment, so without
 * this the SQL would be shipped having never been run — and a migration that
 * fails halfway is the worst thing to hand somebody, because the half that
 * succeeded is now the state of their database.
 *
 * If no local Postgres is installed, or a cluster cannot be started, this
 * skips loudly rather than failing: it is a check on the SQL, not a
 * requirement to have Postgres in order to build a front end.
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Applied before the accounts exist. */
const MIGRATIONS = ['0001_shared_history.sql', '0002_real_readers.sql']
/** Applied after them, so 0003's backfill and 0004's have something to find. */
const LATER = ['0003_everything_saves.sql', '0004_people_and_friends.sql']
const root = new URL('..', import.meta.url).pathname
const PORT = 54329

const skip = (why) => {
  console.log(`\n  ⚠ SQL checks skipped — ${why}`)
  process.exit(0)
}

/** Wherever this distribution keeps initdb/pg_ctl, which is not always on PATH. */
function findBin() {
  const guesses = ['', '/usr/lib/postgresql/16/bin/', '/usr/lib/postgresql/15/bin/', '/usr/local/pgsql/bin/']
  for (const dir of guesses) {
    try {
      execFileSync(`${dir}initdb`, ['--version'], { stdio: 'ignore' })
      return dir
    } catch {
      /* try the next */
    }
  }
  return null
}

const bin = findBin()
if (!bin) skip('no local Postgres (initdb not found)')

// Postgres refuses to run as root, and this environment is root. `su postgres`
// is the ordinary way round it; without that account there is nothing to do.
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
let owner = null
if (asRoot) {
  try {
    execSync('id -u postgres', { stdio: 'ignore' })
    owner = 'postgres'
  } catch {
    skip('running as root and there is no postgres account to drop to')
  }
}

const dir = mkdtempSync(join(asRoot ? '/var/tmp' : tmpdir(), 'manna-pg-'))
const data = join(dir, 'data')
const sock = join(dir, 'sock')

const sh = (cmd, opts = {}) =>
  execSync(owner ? `su ${owner} -c ${JSON.stringify(cmd)}` : cmd, {
    stdio: opts.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    ...opts,
  })

let started = false
try {
  // Ownership first: mkdtemp made this 0700 root, and everything after runs as
  // the postgres account.
  if (owner) execSync(`chown -R ${owner} ${dir} && chmod 700 ${dir}`)
  sh(`mkdir -p ${sock}`, { quiet: true })
  sh(`${bin}initdb -D ${data} -A trust -U postgres`, { quiet: true })
  sh(`${bin}pg_ctl -D ${data} -o "-p ${PORT} -k ${sock} -c listen_addresses=''" -l ${dir}/log start`, { quiet: true })
  started = true

  // The migrations are deliberately full of "already exists, skipping" — that
  // is what idempotent looks like — so their notices are hushed. The checks
  // report through RAISE NOTICE, so theirs are not.
  const psql = (file, { notices = false } = {}) =>
    sh(`psql -v ON_ERROR_STOP=1 -h ${sock} -p ${PORT} -U postgres -q -f ${file}`, {
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, PGOPTIONS: `-c client_min_messages=${notices ? 'notice' : 'warning'}` },
    })

  console.log('\nApplying the migrations to a clean database')
  psql(join(root, 'scripts/pg-scaffold.sql'))
  for (const m of MIGRATIONS) {
    psql(join(root, 'supabase/migrations', m))
    console.log(`  ✓ ${m}`)
  }
  // The accounts have to exist before 0003 for its backfill to have anything
  // to do — that is the migration path a real project is on.
  psql(join(root, 'scripts/pg-seed.sql'))
  for (const m of LATER) {
    psql(join(root, 'supabase/migrations', m))
    console.log(`  ✓ ${m}`)
  }

  // Twice, because "idempotent, so re-running is harmless" is a promise made
  // at the top of every one of these files. Re-running them in order also
  // catches a later migration redefining a policy an earlier one owns — which
  // reverts silently and would otherwise only show up as a feature quietly
  // ceasing to work weeks later.
  for (const m of [...MIGRATIONS, ...LATER]) {
    psql(join(root, 'supabase/migrations', m))
  }
  console.log(`  ✓ all ${MIGRATIONS.length + LATER.length} re-run cleanly on top of themselves`)

  psql(join(root, 'scripts/pg-checks.sql'), { notices: true })
  console.log('\n✓ the migrations apply and behave')
} catch (e) {
  if (!started) skip(`a test cluster would not start (${e.message.split('\n')[0]})`)
  console.error('\n✗ SQL checks failed')
  process.exitCode = 1
} finally {
  if (started) {
    try {
      sh(`${bin}pg_ctl -D ${data} -m immediate stop`, { quiet: true })
    } catch {
      /* going away anyway */
    }
  }
  rmSync(dir, { recursive: true, force: true })
}
