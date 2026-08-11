/**
 * The Spin Catalog.
 *
 * Three views and a settings panel — that is a useState, not a router.
 * App owns persisted state, the once-a-day lock, and the 60-second undo
 * window; the views below are otherwise self-contained.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WheelView from './components/WheelView.jsx'
import TodayCard from './components/TodayCard.jsx'
import FinishedSide from './components/FinishedSide.jsx'
import Settings from './components/Settings.jsx'
import { getState, saveState, clearState, emptyState } from './lib/storage.js'
import {
  completedIds as idsOf,
  isExhausted,
  recordSpin,
  rowFor,
  rowForDate,
  setNotes,
  setReadBy,
  setReaderName,
  undoSpin,
} from './lib/state.js'
import { getEntry, TOTAL, catalogProblems } from './lib/catalog.js'
import { localISODate, msUntilLocalMidnight } from './lib/date.js'

const UNDO_WINDOW_MS = 60_000

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

export default function App() {
  const [state, setStateRaw] = useState(getState)
  const [view, setView] = useState('wheel')
  const [today, setToday] = useState(localISODate)
  const [announcement, setAnnouncement] = useState('')
  const [justSpunId, setJustSpunId] = useState(null)
  const [undo, setUndo] = useState(null) // { entryId, previousLastSpinDate, expiresAt }
  const [now, setNow] = useState(() => Date.now())
  const [dev, setDev] = useState(DEV_PARAM)
  const mainRef = useRef(null)

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

  const commit = useCallback((next) => {
    setStateRaw(next)
    saveState(next)
  }, [])

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
    commit(undoSpin(state, undo.entryId, undo.previousLastSpinDate))
    setUndo(null)
    setJustSpunId(null)
    setAnnouncement('Spin undone. That passage is back in the pool.')
    setView('wheel')
  }, [undo, state, commit])

  const undoInfo = useMemo(() => {
    if (!undo || !todayRow || undo.entryId !== todayRow.id) return null
    const secondsLeft = Math.max(0, Math.ceil((undo.expiresAt - now) / 1000))
    return secondsLeft > 0 ? { secondsLeft } : null
  }, [undo, todayRow, now])

  // Views scroll independently; reset to the top on a switch.
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
      readerNames={state.readerNames}
      onNotes={(notes) => commit(setNotes(state, todayEntry.id, notes))}
      onReadBy={(reader, value) => commit(setReadBy(state, todayEntry.id, reader, value))}
      undo={undoInfo}
      onUndo={doUndo}
      isToday={todayRow.dateISO === today}
      animate={justSpunId === todayEntry.id}
    />
  ) : null

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Result announcements for screen readers. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only-live">
        {announcement}
      </p>

      <header className="sticky top-0 z-10 bg-ground/95 backdrop-blur-sm border-b border-line-soft">
        <div className="mx-auto max-w-lg px-4 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setView('wheel')}
            className="font-serif text-base text-ink tracking-tight text-left min-h-11 flex items-center"
          >
            The Spin Catalog
          </button>
          <button
            type="button"
            onClick={() => setView(view === 'settings' ? 'wheel' : 'settings')}
            aria-label={view === 'settings' ? 'Close settings' : 'Open settings'}
            aria-pressed={view === 'settings'}
            className={`size-11 -mr-2 grid place-items-center rounded-full transition-colors ${
              view === 'settings' ? 'text-ink bg-surface' : 'text-ink-3 hover:text-ink'
            }`}
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2.8v2.4M12 18.8v2.4M4.5 4.5l1.7 1.7M17.8 17.8l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.5 19.5l1.7-1.7M17.8 6.2l1.7-1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <nav className="mx-auto max-w-lg px-4 pb-2 flex gap-1" aria-label="Views">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              aria-current={view === id ? 'page' : undefined}
              className={`min-h-11 px-4 rounded-full text-sm transition-colors ${
                view === id ? 'bg-surface text-ink' : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main ref={mainRef} className="flex-1 mx-auto w-full max-w-lg px-4 py-6 pb-16">
        {dev && (
          <p className="mb-4 rounded-lg border border-warn-line bg-warn-bg p-2.5 text-2xs text-warn">
            Dev mode — the once-a-day lock is off, so you can spin repeatedly. Press Shift+Alt+D (or drop <code>?dev=1</code>) to restore it.
          </p>
        )}

        {catalogProblems.length > 0 && (
          <p className="mb-4 rounded-lg border border-warn-line bg-warn-bg p-2.5 text-2xs text-warn">
            The catalog has {catalogProblems.length} problem(s); affected entries were skipped.
          </p>
        )}

        {view === 'settings' && (
          <Settings
            state={state}
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
            onReaderName={(key, name) => commit(setReaderName(state, key, name))}
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
            <div className="space-y-6">
              <p className="text-2xs text-ink-4">Already spun today. Come back tomorrow for the next one.</p>
              {card}
            </div>
          ))}

        {view === 'today' &&
          (card ?? (
            <div className="py-12 text-center space-y-4">
              <p className="font-serif text-lg text-ink-2">No reading yet today.</p>
              <button
                type="button"
                onClick={() => setView('wheel')}
                className="min-h-12 px-6 rounded-full border border-line text-sm text-ink hover:bg-surface transition-colors"
              >
                Go to the wheel
              </button>
            </div>
          ))}

        {view === 'finished' && <FinishedSide state={state} />}
      </main>
    </div>
  )
}

function CompletionState({ state, onOpenArchive }) {
  return (
    <div className="py-10 text-center space-y-5">
      <p className="eyebrow">
        {TOTAL} of {TOTAL}
      </p>
      <h1 className="font-serif text-3xl leading-tight text-ink">You have read the whole catalog.</h1>
      <p className="font-serif text-ink-2 leading-relaxed max-w-sm mx-auto">
        Every passage has come up exactly once. Nothing is left in the pool, so the wheel has nothing to
        choose between — which is the only way it ever stops.
      </p>
      <p className="text-sm text-ink-3">
        {state.completed.filter((r) => r.notes?.trim()).length} of them have notes attached.
      </p>
      <button
        type="button"
        onClick={onOpenArchive}
        className="min-h-12 px-6 rounded-full border border-line text-sm text-ink hover:bg-surface transition-colors"
      >
        Open the Finished Side
      </button>
    </div>
  )
}
