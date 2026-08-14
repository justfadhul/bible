/**
 * Your account, and whether it is talking to the database.
 *
 * This used to be where you generated an eight-character code and read it out
 * to somebody, or typed in theirs. That is gone: People.jsx lists the accounts
 * that exist, and you add one. Nobody transcribes anything.
 *
 * What is left here is the account itself. The whole panel is still optional —
 * with no project configured the app is exactly what it was, local and private
 * and fully working — so this never blocks reading.
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
  'no-pair': 'Signed in, nowhere to save yet',
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
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState(null)

  if (!sync.enabled) {
    return (
      <Group
        header="Account"
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

  /* ── signed out ── */
  if (!sync.session) {
    return (
      <Group
        header="Account"
        footer="One sign-in each. Everything you read is then saved to your account, and you can see who else is here."
      >
        <AuthForm sync={sync} />
      </Group>
    )
  }

  const syncing = sync.status === 'syncing' || sync.status === 'connecting'

  return (
    <>
      <Group
        header="Account"
        footer={`Signed in as ${sync.session.user?.email ?? 'you'}. Everything you read is saved to your account, so it survives this device.`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={sync.status === 'error' ? 'neutral' : 'accent'}>
            {STATUS_TEXT[sync.status] ?? sync.status}
          </Badge>
        </div>

        {/* Signing in is meant to be enough to be saved. Landing on 'no-pair'
            means the database has no ensure_pair() yet, and until it does,
            reading stays on this device. */}
        {sync.status === 'no-pair' && (
          <div className="mt-3">
            <Alert tone="quiet" icon={ICONS.warning}>
              Your reading is saved on this device, but not yet to the database — run
              supabase/migrations/0003_everything_saves.sql in the SQL editor.
            </Alert>
          </div>
        )}

        {sync.error && (
          <div className="mt-3">
            <Alert tone="quiet" icon={ICONS.warning}>
              {sync.error}
            </Alert>
          </div>
        )}

        {/* Distinct from a sync error: the history is syncing fine, and only
            the roster is stuck — which shows up as somebody who never appears,
            with nothing on screen to explain it. */}
        {sync.rosterError && (
          <div className="mt-3">
            <Alert tone="quiet" icon={ICONS.warning}>
              {sync.rosterError}
            </Alert>
          </div>
        )}

        {localError && (
          <div className="mt-3">
            <Alert tone="quiet" icon={ICONS.warning}>
              {localError}
            </Alert>
          </div>
        )}

        <Button
          variant="secondary"
          className="mt-4 w-full"
          disabled={syncing}
          busy={syncing}
          onClick={sync.resync}
        >
          {syncing ? 'Syncing' : 'Sync now'}
        </Button>
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
    <Group header="Password" footer={`Signed in as ${sync.session.user?.email ?? 'you'}.`}>
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
