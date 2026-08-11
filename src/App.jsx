/**
 * Manna.
 *
 * Three views and a settings panel — that is a useState, not a router.
 * App owns persisted state, appearance, the once-a-day lock, and the
 * 60-second undo window; the views below are otherwise self-contained.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WheelView from './components/WheelView.jsx'
import TodayCard from './components/TodayCard.jsx'
import FinishedSide from './components/FinishedSide.jsx'
import Settings from './components/Settings.jsx'
import AuthPage from './components/AuthPage.jsx'
import { Alert, Brandmark, Button, Card, Icon, ICONS, Spinner, SyncDot, Tabs } from './components/ui.jsx'
import { getState, saveState, clearState, emptyState } from './lib/storage.js'
import { useSync } from './hooks/useSync.js'
import { getTheme, saveTheme, applyTheme, resolvedTheme } from './lib/theme.js'
import { nameFromEmail } from './lib/readers.js'
import { APP_NAME } from './lib/brand.js'
import * as haptics from './lib/haptics.js'
import {
  completedIds as idsOf,
  isExhausted,
  recordSpin,
  rowFor,
  rowForDate,
  setNotes,
  setReadBy,
  removeReader,
  updateReader,
  linkAccount,
  undoSpin,
} from './lib/state.js'
import { getEntry, TOTAL, catalogProblems } from './lib/catalog.js'
import { localISODate, msUntilLocalMidnight } from './lib/date.js'

const UNDO_WINDOW_MS = 60_000
/** Remembers that this device chose to read without an account. */
const WELCOMED_KEY = 'spin-catalog:welcomed'

/**
 * Dev override for the one-spin-a-day lock: append ?dev=1, or press
 * Shift+Alt+D. Deliberately not a visible control — the lock is the point of
 * the app, and the keyboard route exists for when the URL cannot be edited
 * (an embedded preview, for instance).
 */
const DEV_PARAM = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev')

const TABS = [
  ['wheel', 'Wheel'],
  ['today', 'Today'],
  ['finished', 'Finished'],
]

/** A raised circular control, per the system's iconography rules. */
function IconButton({ label, onClick, active, path, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`raised-2 grid size-11 shrink-0 place-items-center rounded-r5
                  ${active ? 'text-accent' : 'text-ink-2'}`}
      style={active ? { boxShadow: 'var(--inset)' } : undefined}
    >
      {children ?? <Icon path={path} size={20} />}
    </button>
  )
}

export default function App() {
  const [state, setStateRaw] = useState(getState)
  const [view, setView] = useState('wheel')
  const [today, setToday] = useState(localISODate)
  const [announcement, setAnnouncement] = useState('')
  const [justSpunId, setJustSpunId] = useState(null)
  const [undo, setUndo] = useState(null) // { entryId, previousLastSpinDate, expiresAt }
  const [now, setNow] = useState(() => Date.now())
  const [dev, setDev] = useState(DEV_PARAM)
  const [theme, setThemeRaw] = useState(getTheme)
  const [skippedAuth, setSkippedAuth] = useState(() => {
    try {
      return localStorage.getItem(WELCOMED_KEY) === '1'
    } catch {
      return true // no storage means no way to remember a dismissal — do not trap anyone here
    }
  })
  const mainRef = useRef(null)

  const setTheme = useCallback((next) => {
    setThemeRaw(next)
    saveTheme(next)
    applyTheme(next)
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setDev((on) => !on)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The local copy is authoritative: it is written first and synchronously, so
  // nothing the reader does ever waits on the network.
  const syncRef = useRef(null)
  const commit = useCallback((next) => {
    setStateRaw(next)
    saveState(next)
    syncRef.current?.push(next)
  }, [])

  const sync = useSync({
    state,
    onMerged: (merged) => {
      setStateRaw(merged)
      saveState(merged)
    },
  })
  syncRef.current = sync

  // Roll the day over live, so a phone left open overnight unlocks by itself.
  useEffect(() => {
    const id = setTimeout(() => setToday(localISODate()), msUntilLocalMidnight())
    return () => clearTimeout(id)
  }, [today])

  // Tick only while an undo is pending, for its countdown.
  useEffect(() => {
    if (!undo) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [undo])

  useEffect(() => {
    if (undo && now >= undo.expiresAt) setUndo(null)
  }, [undo, now])

  const completedIds = useMemo(() => idsOf(state), [state])
  const exhausted = isExhausted(state, TOTAL)
  const spunToday = state.lastSpinDate === today && !dev
  const canSpin = !spunToday && !exhausted

  // Prefer the spin that just happened; otherwise whatever is recorded today.
  const todayRow = useMemo(() => {
    if (justSpunId != null) return rowFor(state, justSpunId)
    return rowForDate(state, today)
  }, [state, justSpunId, today])
  const todayEntry = todayRow ? getEntry(todayRow.id) : null

  // A new day clears the last spin's reveal state.
  useEffect(() => {
    setJustSpunId(null)
    setUndo(null)
  }, [today])

  const onLanded = useCallback(
    (plan) => {
      const previousLastSpinDate = state.lastSpinDate
      commit(recordSpin(state, plan.entry.id, today))
      setJustSpunId(plan.entry.id)
      setUndo({ entryId: plan.entry.id, previousLastSpinDate, expiresAt: Date.now() + UNDO_WINDOW_MS })
      setNow(Date.now())
      setAnnouncement(
        `${plan.category.name}. ${plan.entry.topic}. ${plan.entry.reference}. ${plan.entry.hook} To discuss: ${plan.entry.question}`,
      )
      setView('today')
    },
    [state, commit, today],
  )

  const doUndo = useCallback(() => {
    if (!undo) return
    sync.forget?.(undo.entryId)
    commit(undoSpin(state, undo.entryId, undo.previousLastSpinDate))
    setUndo(null)
    setJustSpunId(null)
    setAnnouncement('Spin undone. That passage is back in the pool.')
    setView('wheel')
  }, [undo, state, commit, sync])

  const undoInfo = useMemo(() => {
    if (!undo || !todayRow || undo.entryId !== todayRow.id) return null
    const secondsLeft = Math.max(0, Math.ceil((undo.expiresAt - now) / 1000))
    return secondsLeft > 0 ? { secondsLeft } : null
  }, [undo, todayRow, now])

  useEffect(() => {
    mainRef.current?.scrollTo?.({ top: 0 })
    window.scrollTo({ top: 0 })
  }, [view])

  const card = todayEntry ? (
    <TodayCard
      key={todayEntry.id}
      entry={todayEntry}
      row={todayRow}
      dateISO={todayRow.dateISO}
      readers={state.readers}
      onNotes={(notes) => commit(setNotes(state, todayEntry.id, notes))}
      onReadBy={(readerId, value) => commit(setReadBy(state, todayEntry.id, readerId, value))}
      undo={undoInfo}
      onUndo={doUndo}
      isToday={todayRow.dateISO === today}
      animate={justSpunId === todayEntry.id}
    />
  ) : null

  // An account IS a reader: signing in claims this device's reader, fills in
  // the name from the address, and re-keys every tick to the account id.
  useEffect(() => {
    const user = sync.session?.user
    if (!user?.id) return
    const next = linkAccount(state, {
      userId: user.id,
      email: user.email ?? null,
      name: nameFromEmail(user.email),
      avatarUrl: user.user_metadata?.avatar_url ?? null,
    })
    if (next !== state) commit(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.session?.user?.id])

  const [hapticsOn, setHapticsOn] = useState(haptics.hapticsEnabled)
  const hapticsPrefs = {
    // 'vibrate' | 'switch' | 'none' — Settings says something different for
    // each, rather than hiding the control on the one device where the reader
    // most needs to be told why nothing is happening.
    mode: haptics.support(),
    enabled: hapticsOn,
    set: (v) => {
      haptics.setHapticsEnabled(v)
      setHapticsOn(v)
      if (v) haptics.toggle()
    },
    test: haptics.test,
  }

  const isDark = resolvedTheme(theme) === 'dark'

  // Nothing can be decided until we know whether there is a session: signed in
  // and signed out look identical for the first beat of every load, and
  // guessing means a returning reader gets a flash of the sign-in page before
  // their own history appears.
  if (sync.enabled && !sync.ready) return <BootScreen />

  // Show the way in once: on a device with no session, no history, and no
  // record of having chosen to read locally. Anyone mid-way through a
  // catalog never sees it, session or not.
  const needsWelcome =
    sync.enabled && !sync.session && !skippedAuth && state.completed.length === 0

  if (needsWelcome) {
    return (
      <AuthPage
        sync={sync}
        onSkip={() => {
          try { localStorage.setItem(WELCOMED_KEY, '1') } catch { /* it will ask once more */ }
          setSkippedAuth(true)
        }}
      />
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      <p aria-live="polite" aria-atomic="true" className="sr-only-live">
        {announcement}
      </p>

      <header
        className="sticky top-0 z-20 bg-ground/92 backdrop-blur-md"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 pt-3 pb-2">
          <h1 className="font-serif text-xl font-semibold tracking-[-0.01em]">{APP_NAME}</h1>
          <div className="flex flex-1 justify-start">
            <SyncDot status={sync.status} lastSyncedAt={sync.lastSyncedAt} />
          </div>
          <IconButton
            label={`Switch to ${isDark ? 'light' : 'dark'} appearance`}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {/* The sun's rays retract as the crescent closes over it, so the
                control reads as one object changing rather than two icons. */}
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
              <mask id="moon-cut">
                <rect width="24" height="24" fill="#fff" />
                <circle cx={isDark ? 17.5 : 28} cy={isDark ? 6.5 : 0} r="7.6" fill="#000" style={{ transition: 'cx .5s var(--ease), cy .5s var(--ease)' }} />
              </mask>
              <circle
                cx="12"
                cy="12"
                r={isDark ? 8.6 : 4.9}
                fill="currentColor"
                mask="url(#moon-cut)"
                style={{ transition: 'r .5s var(--ease)' }}
              />
              <g
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                style={{
                  opacity: isDark ? 0 : 1,
                  transform: `rotate(${isDark ? -45 : 0}deg)`,
                  transformOrigin: 'center',
                  transition: 'opacity .35s var(--ease), transform .5s var(--ease)',
                }}
              >
                <path d="M12 1.9v2.2M12 19.9v2.2M22.1 12h-2.2M4.1 12H1.9M19.14 4.86l-1.56 1.56M6.42 17.58l-1.56 1.56M19.14 19.14l-1.56-1.56M6.42 6.42 4.86 4.86" />
              </g>
            </svg>
          </IconButton>
          <IconButton
            label={view === 'settings' ? 'Close settings' : 'Settings'}
            active={view === 'settings'}
            path={ICONS.gear}
            onClick={() => setView(view === 'settings' ? 'wheel' : 'settings')}
          />
        </div>

        <div className="mx-auto max-w-lg px-4">
          <Tabs tabs={TABS} value={view} onChange={setView} label="Views" />
        </div>
      </header>

      <main ref={mainRef} className="mx-auto w-full max-w-lg flex-1 px-4 pt-5 pb-14">
        {/* Raised by something that has already finished and unmounted — a new
            password saving itself signs you in, which takes the form away. */}
        {sync.notice && (
          <div className="mb-5">
            <Alert icon={ICONS.check}>
              <div className="flex items-start justify-between gap-3">
                <span>{sync.notice}</span>
                <button
                  type="button"
                  onClick={sync.dismissNotice}
                  aria-label="Dismiss"
                  className="-my-1 -mr-1 shrink-0 rounded-r3 p-1 opacity-80"
                >
                  <Icon path="M6 6l12 12M18 6 6 18" size={18} />
                </button>
              </div>
            </Alert>
          </div>
        )}

        {dev && (
          <div className="mb-5">
            <Alert icon={ICONS.warning}>
              <span className="font-semibold">Dev mode.</span> The once-a-day lock is off, so you can spin
              repeatedly. Press Shift+Alt+D to restore it.
            </Alert>
          </div>
        )}

        {catalogProblems.length > 0 && (
          <div className="mb-5">
            <Alert icon={ICONS.warning} tone="quiet">
              The catalog has {catalogProblems.length} problem(s); affected entries were skipped.
            </Alert>
          </div>
        )}

        {view === 'settings' && (
          <Settings
            state={state}
            sync={sync}
            theme={theme}
            onTheme={setTheme}
            onImport={(next) => {
              commit(next)
              setJustSpunId(null)
              setUndo(null)
            }}
            onReset={() => {
              clearState()
              setStateRaw(emptyState())
              setJustSpunId(null)
              setUndo(null)
            }}
            onUpdateReader={(id, patch) => commit(updateReader(state, id, patch))}
            onRemoveReader={(id) => commit(removeReader(state, id))}
            haptics={hapticsPrefs}
          />
        )}

        {view === 'wheel' &&
          (exhausted ? (
            <CompletionState state={state} onOpenArchive={() => setView('finished')} />
          ) : canSpin ? (
            <WheelView
              completedIds={completedIds}
              onLanded={onLanded}
              onAnnounce={setAnnouncement}
              exhausted={exhausted}
            />
          ) : (
            <div className="space-y-4">
              <p className="eyebrow">Already spun today</p>
              {card}
            </div>
          ))}

        {view === 'today' &&
          (card ?? (
            <Card className="px-6 py-12 text-center">
              <p className="font-serif text-lg text-ink-2">No reading yet today.</p>
              <div className="mt-5 flex justify-center">
                <Button onClick={() => setView('wheel')}>Go to the wheel</Button>
              </div>
            </Card>
          ))}

        {view === 'finished' && (
          <FinishedSide
            state={state}
            pulling={sync.status === 'syncing' || sync.status === 'connecting'}
            onReadBy={(entryId, readerId, value) => commit(setReadBy(state, entryId, readerId, value))}
          />
        )}
      </main>
    </div>
  )
}

/**
 * The wait for a stored session to be read back.
 *
 * Usually a few frames, occasionally a network round trip when the token needs
 * refreshing. So the mark appears at once — a painted ground that matches
 * where you are going is not a loading screen, it is just the app opening —
 * and the words only fade in after half a second, by which point the wait is
 * long enough to be worth explaining. A spinner that flashes for 80ms reads as
 * a glitch; one that never appears at all reads as a hang.
 */
function BootScreen() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 500)
    return () => clearTimeout(t)
  }, [])
  return (
    <main className="grid min-h-dvh place-items-center bg-ground px-6" aria-busy="true">
      <div className="text-center">
        <div className="flex justify-center">
          <Brandmark />
        </div>
        <h1 className="mt-5 font-serif text-3xl font-semibold tracking-[-0.02em]">{APP_NAME}</h1>
        <p
          className="mt-3 flex items-center justify-center gap-2 text-sm text-ink-2"
          style={{ opacity: slow ? 1 : 0, transition: 'opacity .4s var(--ease)' }}
          role="status"
        >
          <Spinner size={16} />
          {slow ? 'Opening your reading…' : ''}
        </p>
      </div>
    </main>
  )
}

function CompletionState({ state, onOpenArchive }) {
  return (
    <Card className="px-6 py-12 text-center">
      <p className="eyebrow">
        {TOTAL} of {TOTAL}
      </p>
      <h2 className="mt-3 font-serif text-3xl leading-tight font-semibold text-balance">
        You have read the whole catalog.
      </h2>
      <p className="mx-auto mt-4 max-w-sm leading-relaxed text-ink-2">
        Every passage has come up exactly once. Nothing is left in the pool, so the wheel has nothing to
        choose between — which is the only way it ever stops.
      </p>
      <p className="mt-4 text-sm text-ink-2">
        {state.completed.filter((r) => r.notes?.trim()).length} of them have notes attached.
      </p>
      <div className="mt-6 flex justify-center">
        <Button onClick={onOpenArchive}>Open the Finished Side</Button>
      </div>
    </Card>
  )
}
