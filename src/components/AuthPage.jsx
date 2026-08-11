/**
 * The way in.
 *
 * This is a door, not a gate. Signing in is what makes a history shared
 * between phones — it is not what makes the app work, so "read on this device"
 * is a real choice offered as plainly as the sign-in itself, not a grey
 * link underneath it. Someone who never wants an account should be able to
 * start reading in one tap and never see this screen again.
 *
 * It appears once, on a device that has never been used and never dismissed
 * it. After that the app opens on the wheel, and everything here is still
 * reachable from Settings → Sharing.
 */
import { useState } from 'react'
import { Alert, Button, Field, Icon, ICONS } from './ui.jsx'
import { APP_NAME, APP_TAGLINE } from '../lib/brand.js'
import { describeSyncError } from '../hooks/useSync.js'
import * as haptics from '../lib/haptics.js'

/** The wheel as a mark: six segments and a pointer, drawn from the ink tokens. */
function Mark() {
  return (
    <svg viewBox="0 0 64 64" className="size-16" aria-hidden="true">
      <g transform="translate(32 34)">
        <circle r="21.5" fill="none" stroke="var(--hairline-strong)" strokeWidth="1.5" />
        <path d="M0 -19 A19 19 0 0 1 16.5 9.5 L0 0 Z" fill="var(--accent)" />
        <path d="M16.5 9.5 A19 19 0 0 1 -16.5 9.5 L0 0 Z" fill="var(--ink-3)" />
        <path d="M-16.5 9.5 A19 19 0 0 1 0 -19 L0 0 Z" fill="var(--ink-2)" />
        <circle r="6.5" fill="var(--surface-raised)" stroke="var(--hairline-strong)" strokeWidth="1.2" />
      </g>
      <path d="M32 5.5 L27.5 14 L36.5 14 Z" fill="var(--ink)" />
    </svg>
  )
}

export default function AuthPage({ sync, onSkip }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const send = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await sync.sendLink(email)
      setSent(true)
      haptics.toggle()
    } catch (err) {
      haptics.error()
      setError(describeSyncError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-7 px-5 py-10">
      <header className="reveal text-center">
        <div className="flex justify-center">
          <Mark />
        </div>
        <h1 className="mt-5 font-serif text-4xl font-semibold tracking-[-0.02em]">{APP_NAME}</h1>
        <p className="mt-2.5 text-balance text-ink-2">{APP_TAGLINE}</p>
      </header>

      {sent ? (
        <div className="reveal reveal-delay-1 space-y-3.5">
          <Alert icon={ICONS.check}>
            A sign-in link is on its way to <span className="font-semibold">{email}</span>. Open it on this
            device and you will land back here, signed in.
          </Alert>
          <Button variant="secondary" className="w-full" onClick={() => setSent(false)}>
            Use a different address
          </Button>
          <Button variant="quiet" className="w-full" onClick={onSkip}>
            Skip for now
          </Button>
        </div>
      ) : (
        <>
          <form onSubmit={send} className="reveal reveal-delay-1 space-y-3.5">
            <Field
              id="auth-email"
              type="email"
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
              required
              error={error}
              hint="No password. We send a link, you tap it."
            />
            <Button type="submit" size="lg" className="w-full" disabled={busy || !email.trim()} busy={busy}>
              Email me a sign-in link
            </Button>
          </form>

          <div className="reveal reveal-delay-2 flex items-center gap-3">
            <span className="h-px flex-1 bg-hairline" />
            <span className="text-2xs tracking-[0.1em] uppercase text-ink-2">or</span>
            <span className="h-px flex-1 bg-hairline" />
          </div>

          <div className="reveal reveal-delay-2 space-y-3">
            <Button variant="secondary" size="lg" className="w-full" onClick={onSkip}>
              Read on this device
            </Button>
            <p className="px-2 text-center text-xs leading-relaxed text-ink-2">
              Everything works without an account — the wheel, the archive, your notes. Signing in only
              adds one thing: the same history on more than one phone. You can do it later from Settings.
            </p>
          </div>
        </>
      )}

      <ul className="reveal reveal-delay-3 mx-auto max-w-xs space-y-2.5 text-sm text-ink-2">
        {[
          'One passage a day, chosen by the wheel',
          'No passage twice until all 286 are read',
          '286 texts most reading plans skip',
        ].map((line) => (
          <li key={line} className="flex items-start gap-2.5">
            <Icon path={ICONS.check} size={16} className="mt-0.5 shrink-0 text-accent" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </main>
  )
}
