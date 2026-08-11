/**
 * Signing in, signing up, and getting back in.
 *
 * One component because there are two doors into this — the welcome screen and
 * Settings → Sharing — and a form with five states kept in two files drifts.
 *
 * Email and password is the front door. A code still exists, but only for the
 * two jobs a password account genuinely needs an email for: proving a new
 * address is real, and getting back in after forgetting the password. Neither
 * is a link, so none of the link problems apply — nothing to open on the wrong
 * device, no redirect allow-list to keep in step with the domain.
 *
 * The forgotten-password flow asks for the new password *before* the code
 * rather than after. Verifying a code signs you in, which unmounts this form
 * the moment it succeeds; asking afterwards would race the app's own
 * navigation for the chance to finish the job. Collecting it first makes the
 * whole thing one action that either happens or does not.
 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Field, Icon, ICONS } from './ui.jsx'
import { describeSyncError } from '../hooks/useSync.js'
import * as haptics from '../lib/haptics.js'

const CODE_LENGTH = 6
export const MIN_PASSWORD = 8
/** Supabase will not send a second code sooner than this. */
const RESEND_AFTER_S = 60

const digits = (s) => s.replace(/\D/g, '').slice(0, CODE_LENGTH)

const EYE = 'M2.2 12S5.8 5.5 12 5.5 21.8 12 21.8 12 18.2 18.5 12 18.5 2.2 12 2.2 12Z'
const EYE_OFF = 'M4 4l16 16M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6.2 0 9.8 6.5 9.8 6.5a17 17 0 0 1-3.3 4M6.5 8A17 17 0 0 0 2.2 12S5.8 18.5 12 18.5c1.1 0 2-.2 2.9-.5'

/** The one rule that blocks, plus two that only ever encourage. */
function strengthOf(pw) {
  const long = pw.length >= MIN_PASSWORD
  const mixed = /[a-z]/.test(pw) && /[A-Z0-9]/.test(pw)
  const roomy = pw.length >= 12 || /[^\w\s]/.test(pw)
  return { ok: long, score: [long, mixed, roomy].filter(Boolean).length }
}

function PasswordField({ id, label, value, onChange, hint, error, autoComplete, inputRef, showStrength }) {
  const [shown, setShown] = useState(false)
  const { ok, score } = strengthOf(value)
  return (
    <div>
      <Field
        id={id}
        ref={inputRef}
        label={label}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        error={error}
        hint={showStrength ? undefined : hint}
        trailing={
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            className="grid size-11 place-items-center rounded-r3 text-ink-2"
          >
            <Icon path={shown ? EYE_OFF : EYE} size={20}>
              {!shown && (
                <>
                  <path d={EYE} />
                  <circle cx="12" cy="12" r="3.1" />
                </>
              )}
            </Icon>
          </button>
        }
      />
      {showStrength && !error && (
        <div className="mt-2 flex items-center gap-2.5">
          <span aria-hidden="true" className="flex flex-1 gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1 flex-1 rounded-full"
                style={{
                  background: i < score ? 'var(--accent)' : 'var(--surface-inset)',
                  boxShadow: i < score ? 'none' : 'var(--inset)',
                  transition: 'background-color .3s var(--ease)',
                }}
              />
            ))}
          </span>
          <span className={`text-xs ${ok ? 'text-ink-2' : 'text-ink-2'}`}>
            {value.length === 0
              ? `${MIN_PASSWORD} characters or more`
              : ok
                ? ['', 'Fine', 'Good', 'Strong'][score]
                : `${MIN_PASSWORD - value.length} more to go`}
          </span>
        </div>
      )}
    </div>
  )
}

export default function AuthForm({ sync, size = 'md' }) {
  const [mode, setMode] = useState('signin') // signin | signup | forgot | code
  const [intent, setIntent] = useState(null) // what the code, once verified, is for
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [wait, setWait] = useState(0)
  const codeRef = useRef(null)
  const passwordRef = useRef(null)
  // Autofill can fill the code field and fire change twice; verify once each.
  const tried = useRef('')

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const go = (next) => {
    setMode(next)
    setError(null)
    setCode('')
    tried.current = ''
  }

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      haptics.error()
      setError(describeSyncError(e))
      return false
    } finally {
      setBusy(false)
    }
    return true
  }

  const askForCode = async (why) => {
    const ok = await run(() => sync.sendCode(email, { createUser: false }))
    if (!ok) return
    setIntent(why)
    setCode('')
    tried.current = ''
    setMode('code')
    setWait(RESEND_AFTER_S)
    haptics.toggle()
    setTimeout(() => codeRef.current?.focus(), 60)
  }

  const submitSignIn = () =>
    run(async () => {
      await sync.signIn(email, password)
      haptics.toggle()
    })

  const submitSignUp = async () => {
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`)
      passwordRef.current?.focus()
      return
    }
    let confirm = false
    const ok = await run(async () => {
      const { needsConfirmation } = await sync.signUp(email, password)
      confirm = needsConfirmation
      haptics.toggle()
    })
    // No session means the project wants the address proved first, and the
    // signup email carries the code that does it.
    if (ok && confirm) {
      setIntent('confirm')
      setMode('code')
      setWait(RESEND_AFTER_S)
      setTimeout(() => codeRef.current?.focus(), 60)
    }
  }

  const submitCode = async (value) => {
    if (value.length !== CODE_LENGTH || tried.current === value) return
    tried.current = value
    const ok = await run(async () => {
      await sync.verifyCode(email, value)
      // Signed in now. In the reset flow the point was the password, and this
      // form is about to be unmounted by that very sign-in — so the notice
      // lives on the sync hook, which outlives it.
      if (intent === 'reset') {
        await sync.setPassword(password)
        sync.notify?.('Your new password is saved.')
      }
      haptics.toggle()
    })
    if (!ok) {
      setCode('')
      codeRef.current?.focus()
    }
  }

  /* ── the code step ── */
  if (mode === 'code') {
    return (
      <div className="space-y-3.5">
        <Alert tone="quiet" icon={ICONS.info}>
          {intent === 'confirm'
            ? 'Almost there — confirm the address. '
            : 'To prove the address is yours, '}
          a six-digit code is on its way to <span className="font-semibold text-ink">{email}</span>. It is
          good for one hour.
        </Alert>

        <form
          className="space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            submitCode(code)
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
              if (next.length === CODE_LENGTH) submitCode(next)
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
              // Centring letter-spaced text leaves a trailing gap on the right;
              // the indent puts the digits back on the axis.
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
            {intent === 'reset' ? 'Set my new password' : 'Confirm and sign in'}
          </Button>
        </form>

        <div className="flex gap-2.5">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={busy || wait > 0}
            busy={busy && wait === 0}
            onClick={() => askForCode(intent)}
          >
            {wait > 0 ? `Resend in ${wait}s` : 'Send a new code'}
          </Button>
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => go('signin')}>
            Start over
          </Button>
        </div>
      </div>
    )
  }

  /* ── the three password steps, which share a shape ── */
  const copy = {
    signin: { action: 'Sign in', pwLabel: 'Password', pwAuto: 'current-password' },
    signup: { action: 'Create account', pwLabel: 'Password', pwAuto: 'new-password' },
    forgot: { action: 'Email me a code', pwLabel: 'New password', pwAuto: 'new-password' },
  }[mode]

  const blocked = !email.trim() || !password || (mode !== 'signin' && password.length < MIN_PASSWORD)

  return (
    <div className="space-y-3.5">
      {mode === 'forgot' && (
        <Alert tone="quiet" icon={ICONS.info}>
          Choose the password you want, then confirm the code we email you. Nothing changes until the
          code is entered.
        </Alert>
      )}

      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (mode === 'signin') submitSignIn()
          else if (mode === 'signup') submitSignUp()
          else askForCode('reset')
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
          enterKeyHint="next"
          required
          error={mode === 'signin' ? error : null}
        />

        <PasswordField
          id="auth-password"
          inputRef={passwordRef}
          label={copy.pwLabel}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(null)
          }}
          autoComplete={copy.pwAuto}
          error={mode === 'signin' ? null : error}
          showStrength={mode !== 'signin'}
        />

        <Button type="submit" size={size} className="w-full" disabled={busy || blocked} busy={busy}>
          {copy.action}
        </Button>
      </form>

      {/* One row of routes out, so no state is a dead end. */}
      <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-center">
        {mode === 'signin' ? (
          <>
            <Button variant="quiet" size="sm" onClick={() => go('signup')}>
              Create an account
            </Button>
            <span aria-hidden="true" className="text-ink-3">
              ·
            </span>
            <Button variant="quiet" size="sm" onClick={() => go('forgot')}>
              Forgot password
            </Button>
          </>
        ) : (
          <Button variant="quiet" size="sm" onClick={() => go('signin')}>
            {mode === 'signup' ? 'I already have an account' : 'Back to signing in'}
          </Button>
        )}
      </div>
    </div>
  )
}
