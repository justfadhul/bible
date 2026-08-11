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
import { Brandmark, Button, Icon, ICONS } from './ui.jsx'
import AuthForm from './AuthForm.jsx'
import { APP_NAME, APP_TAGLINE } from '../lib/brand.js'

export default function AuthPage({ sync, onSkip }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-7 px-5 py-10">
      <header className="reveal text-center">
        <div className="flex justify-center">
          <Brandmark />
        </div>
        <h1 className="mt-5 font-serif text-4xl font-semibold tracking-[-0.02em]">{APP_NAME}</h1>
        <p className="mt-2.5 text-balance text-ink-2">{APP_TAGLINE}</p>
      </header>

      <div className="reveal reveal-delay-1">
        <AuthForm sync={sync} size="lg" />
      </div>

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
          Everything works without an account — the wheel, the archive, your notes. Signing in only adds
          one thing: the same history on more than one phone. You can do it later from Settings.
        </p>
      </div>

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
