/**
 * Sign in, in two steps: an address, then the six digits it receives.
 *
 * One component because there are two doors into this — the welcome screen and
 * Settings → Sharing — and a two-step form kept in two files drifts. Every
 * decision about codes lives here.
 *
 * A code rather than a link because a link has to come back to somewhere. It
 * can be opened on the laptop when the phone is what needs signing in, it can
 * be pre-fetched and burned by a mail scanner before anyone touches it, and it
 * only works if the deployment's exact origin is on Supabase's redirect
 * allow-list — a list that silently falls out of date the first time the
 * domain changes. Six digits typed into the device already in your hand has
 * none of those failure modes.
 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Field, ICONS } from './ui.jsx'
import { describeSyncError } from '../hooks/useSync.js'
import * as haptics from '../lib/haptics.js'

const CODE_LENGTH = 6
/** Supabase will not send a second code sooner than this. */
const RESEND_AFTER_S = 60

const digits = (s) => s.replace(/\D/g, '').slice(0, CODE_LENGTH)

export default function SignInForm({ sync, size = 'md', autoFocus = false }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [wait, setWait] = useState(0)
  const codeRef = useRef(null)
  // Autofill can fill the field and fire change twice; verify once per code.
  const tried = useRef('')

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await sync.sendCode(email)
      tried.current = ''
      setCode('')
      setStep('code')
      setWait(RESEND_AFTER_S)
      haptics.toggle()
      // The field is the only thing to do next, so put the cursor in it.
      setTimeout(() => codeRef.current?.focus(), 60)
    } catch (e) {
      haptics.error()
      setError(describeSyncError(e))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (value) => {
    if (value.length !== CODE_LENGTH || tried.current === value) return
    tried.current = value
    setBusy(true)
    setError(null)
    try {
      await sync.verifyCode(email, value)
      haptics.toggle()
      // No success state to render: a session appears and the app moves on.
    } catch (e) {
      haptics.error()
      setError(describeSyncError(e))
      setCode('')
      codeRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  if (step === 'code') {
    return (
      <div className="space-y-3.5">
        <Alert tone="quiet" icon={ICONS.info}>
          A six-digit code is on its way to <span className="font-semibold text-ink">{email}</span>. It is
          good for one hour.
        </Alert>

        <form
          className="space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            verify(code)
          }}
        >
          <Field
            id="auth-code"
            ref={codeRef}
            label="Code"
            value={code}
            onChange={(e) => {
              const next = digits(e.target.value)
              setCode(next)
              setError(null)
              // Six digits is the whole input — there is nothing to confirm.
              if (next.length === CODE_LENGTH) verify(next)
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="go"
            maxLength={CODE_LENGTH}
            placeholder="••••••"
            error={error}
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '1.5rem',
              fontWeight: 600,
              letterSpacing: '0.45em',
              // Centring text that is letter-spaced leaves a trailing gap on
              // the right; the indent puts the digits back on the axis.
              textIndent: '0.45em',
              textAlign: 'center',
            }}
          />
          <Button
            type="submit"
            size={size}
            className="w-full"
            disabled={busy || code.length !== CODE_LENGTH}
            busy={busy}
          >
            Sign in
          </Button>
        </form>

        <div className="flex gap-2.5">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={busy || wait > 0}
            onClick={send}
          >
            {wait > 0 ? `Resend in ${wait}s` : 'Send a new code'}
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => {
              setStep('email')
              setError(null)
              setCode('')
            }}
          >
            Change address
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      className="space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <Field
        id="auth-email"
        type="email"
        label="Email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value)
          setError(null)
        }}
        placeholder="you@example.com"
        autoComplete="email"
        inputMode="email"
        enterKeyHint="send"
        autoFocus={autoFocus}
        required
        error={error}
        hint="No password. We email you a six-digit code."
      />
      <Button type="submit" size={size} className="w-full" disabled={busy || !email.trim()} busy={busy}>
        Email me a code
      </Button>
    </form>
  )
}
