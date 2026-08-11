/**
 * Sharing: sign in with an email and password, then create or join a pair.
 *
 * The whole panel is optional. With no session the app is exactly what it was
 * before — local, private, and fully working — so this never blocks reading.
 */
import { useState } from 'react'
import { Alert, Badge, Button, Card, Field, Icon, ICONS } from './ui.jsx'
import AuthForm, { MIN_PASSWORD } from './AuthForm.jsx'
import { describeSyncError } from '../hooks/useSync.js'
import * as haptics from '../lib/haptics.js'

const STATUS_TEXT = {
  off: 'Not configured on this build.',
  connecting: 'Connecting…',
  syncing: 'Syncing…',
  synced: 'Up to date',
  'signed-out': 'Signed out',
  'no-pair': 'Signed in, not paired yet',
  error: 'Sync problem',
}

function Group({ header, footer, children, className = '' }) {
  return (
    <section>
      {header && <h2 className="eyebrow mb-2 px-1">{header}</h2>}
      <Card className={`px-4 py-4 ${className}`}>{children}</Card>
      {footer && <p className="mt-2 px-1 text-xs leading-relaxed text-ink-2">{footer}</p>}
    </section>
  )
}

export default function Sharing({ sync }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState(null)
  const [copied, setCopied] = useState(false)

  if (!sync.enabled) {
    return (
      <Group
        header="Sharing"
        footer="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env to turn this on. Without them the app runs entirely on this device, which is a perfectly good way to use it."
      >
        <p className="text-sm text-ink-2">No Supabase project is configured for this build.</p>
      </Group>
    )
  }

  const run = async (fn) => {
    setBusy(true)
    setLocalError(null)
    try {
      await fn()
    } catch (e) {
      haptics.error()
      setLocalError(describeSyncError(e))
    } finally {
      setBusy(false)
    }
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(sync.pair.invite_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* the code is on screen either way */
    }
  }

  /* ── signed out ── */
  if (!sync.session) {
    return (
      <Group
        header="Sharing"
        footer="One sign-in each, then one of you shares a group code. Until then everything stays on this device."
      >
        <AuthForm sync={sync} />
      </Group>
    )
  }

  /* ── signed in, no pair ── */
  if (!sync.pair) {
    return (
      <>
        <Group header="Sharing" footer={`Signed in as ${sync.session.user?.email ?? 'you'}.`}>
          <div className="space-y-4">
            <div>
              <p className="text-sm leading-relaxed text-ink-2">
                Start a shared history and send the code to the others, or enter one you have been given.
              </p>
              <Button
                className="mt-3 w-full"
                disabled={busy}
                busy={busy}
                onClick={() => run(() => sync.createPair())}
              >
                Start a shared history
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-hairline" />
              <span className="text-2xs tracking-[0.1em] uppercase text-ink-2">or</span>
              <span className="h-px flex-1 bg-hairline" />
            </div>

            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                run(() => sync.joinPair(code.trim().toUpperCase()))
              }}
            >
              <Field
                id="join-code"
                label="Invite code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="XXXXXXXX"
                maxLength={8}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                error={localError}
              />
              <Button
                type="submit"
                variant="secondary"
                className="w-full"
                disabled={busy || code.trim().length < 4}
                busy={busy}
              >
                Join with a code
              </Button>
            </form>
          </div>
        </Group>

        <Account sync={sync} busy={busy} run={run} />
      </>
    )
  }

  /* ── paired ── */
  const waiting = sync.pair.member_count < 2
  const syncing = sync.status === 'syncing' || sync.status === 'connecting'

  return (
    <>
      <Group
        header="Sharing"
        footer={
          waiting
            ? 'Give this code to the others. Each signs in on their own device and enters it once.'
            : 'Every device reads and writes the same history. Changes appear on the others without a refresh.'
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Invite code</p>
            <p className="mt-1.5 font-mono text-2xl font-semibold tracking-[0.18em] tabular-nums">
              {sync.pair.invite_code}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={copyCode}>
            <Icon path={ICONS.copy} size={16} />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone={sync.status === 'error' ? 'neutral' : 'accent'}>
            {STATUS_TEXT[sync.status] ?? sync.status}
          </Badge>
          <Badge>
            {waiting
              ? 'Waiting for the second reader'
              : `${sync.pair.member_count} readers signed in`}
          </Badge>
        </div>

        {sync.error && (
          <div className="mt-3">
            <Alert tone="quiet" icon={ICONS.warning}>
              {sync.error}
            </Alert>
          </div>
        )}

        <div className="mt-4 flex gap-2.5">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={syncing}
            busy={syncing}
            onClick={sync.resync}
          >
            {syncing ? 'Syncing' : 'Sync now'}
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            disabled={busy || syncing}
            busy={busy}
            onClick={() => run(sync.leavePair)}
          >
            Leave pair
          </Button>
        </div>
      </Group>

      <Account sync={sync} busy={busy} run={run} />
    </>
  )
}

/**
 * The account itself: who you are signed in as, and the two things you can do
 * about it. Changing a password while signed in needs no code — the session
 * already proves the address — so it is a field and a button, not a flow.
 */
function Account({ sync, busy, run }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [done, setDone] = useState(false)

  return (
    <Group header="Account" footer={`Signed in as ${sync.session.user?.email ?? 'you'}.`}>
      <div className="space-y-3">
        {done && (
          <Alert icon={ICONS.check}>Password changed. It is what you will sign in with from now on.</Alert>
        )}

        {open ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              run(async () => {
                await sync.setPassword(password)
                setPassword('')
                setOpen(false)
                setDone(true)
              })
            }}
          >
            <Field
              id="new-password"
              type="password"
              label="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              hint={`At least ${MIN_PASSWORD} characters.`}
              error={null}
            />
            <div className="flex gap-2.5">
              <Button
                variant="secondary"
                className="flex-1"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  setPassword('')
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={busy || password.length < MIN_PASSWORD}
                busy={busy}
              >
                Save
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              setDone(false)
              setOpen(true)
            }}
          >
            Change password
          </Button>
        )}

        <Button variant="secondary" className="w-full" disabled={busy} busy={busy} onClick={() => run(sync.signOut)}>
          Sign out
        </Button>
      </div>
    </Group>
  )
}
