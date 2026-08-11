/**
 * The Wheel tab, on a day already spent.
 *
 * It used to render the whole of today's reading here, which made the Wheel
 * tab and the Today tab the same screen — two tabs, one page, and no reason to
 * have pressed either one rather than the other.
 *
 * So this answers the questions the Wheel tab is actually for once the spin is
 * gone: when do I get another one, what did the wheel give us, has anybody else
 * read it, and how far through are we. Today's passage is one line and a way
 * through to it, not a copy of the card that lives next door.
 */
import { useEffect, useState } from 'react'
import { Avatar, Badge, Button, Card, Icon, ICONS } from './ui.jsx'
import ProgressStrip from './ProgressStrip.jsx'
import { displayName } from '../lib/readers.js'
import { getCategory, getEntry, TOTAL } from '../lib/catalog.js'
import { formatShortDate, msUntilLocalMidnight } from '../lib/date.js'
import { byNewest } from '../lib/state.js'
import { readerProgress } from '../lib/stats.js'
import { inkOn } from '../lib/wheel.js'

const HOUR = 3_600_000

/**
 * Time until the wheel unlocks.
 *
 * Seconds appear only inside the last hour, and the clock ticks per second
 * only then — a per-second re-render for the seven hours after breakfast is a
 * battery cost with nothing to show for it, since the minutes digit is all
 * that changes.
 */
function Countdown() {
  const [left, setLeft] = useState(() => msUntilLocalMidnight())

  useEffect(() => {
    const period = left > HOUR ? 30_000 : 1000
    const id = setInterval(() => setLeft(msUntilLocalMidnight()), period)
    return () => clearInterval(id)
  }, [left > HOUR])

  const total = Math.max(0, Math.floor(left / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const near = left <= HOUR

  // The whole day, spent so far — a bar that empties as midnight comes.
  const fraction = Math.min(1, Math.max(0, 1 - left / 86_400_000))

  return (
    <Card className="px-5 py-5" level={4}>
      <p className="eyebrow">Next spin</p>
      <p
        className="mt-2 font-serif text-4xl leading-none font-semibold tabular-nums"
        role="timer"
        aria-live="off"
      >
        {total === 0 ? 'Any moment' : near ? `${m}:${String(s).padStart(2, '0')}` : `${h}h ${m}m`}
      </p>
      <p className="mt-2.5 text-sm text-ink-2">
        {total === 0
          ? 'The day is turning over — the wheel is about to come back.'
          : near
            ? 'The wheel unlocks at midnight, wherever you are.'
            : 'One a day is the whole idea. The wheel unlocks at midnight, wherever you are.'}
      </p>
      <span className="sunken mt-4 block h-1.5 w-full overflow-hidden rounded-full">
        <span
          className="block h-full rounded-full bg-accent"
          style={{ width: `${fraction * 100}%`, transition: 'width 1s linear' }}
        />
      </span>
    </Card>
  )
}

/** Today's result, named but not restated in full. */
function TodaysSpin({ row, readers, onOpen }) {
  const entry = getEntry(row.id)
  if (!entry) return null
  const category = getCategory(entry.category)

  return (
    <Card className="px-5 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge style={{ background: category?.color, color: inkOn(category?.color ?? '#000'), boxShadow: 'var(--e2)' }}>
          {category?.name}
        </Badge>
      </div>
      <h2 className="mt-3 font-serif text-xl leading-tight font-semibold text-balance">{entry.topic}</h2>
      <p className="mt-1 font-serif text-ink-2">{entry.reference}</p>

      <Button variant="secondary" className="mt-4 w-full" onClick={onOpen}>
        Open today&rsquo;s reading
        <Icon path={ICONS.chevron} size={16} />
      </Button>

      {/* Who has actually read it — the thing you would open the app to check
          when the passage itself is already in your head. */}
      <ul className="mt-4 space-y-2">
        {readers.map((reader, i) => {
          const done = row.readBy?.includes(reader.id)
          const wrote = Boolean(row.notesBy?.[reader.id]?.trim())
          return (
            <li key={reader.id} className="flex items-center gap-2.5">
              <Avatar reader={reader} index={i} size={26} />
              <span className={`min-w-0 flex-1 truncate text-sm ${done ? 'text-ink' : 'text-ink-2'}`}>
                {displayName(reader, i)}
              </span>
              <span className="shrink-0 text-2xs text-ink-2">
                {done ? (wrote ? 'read · wrote a note' : 'read') : 'not yet'}
              </span>
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: done ? 'var(--ok)' : 'var(--surface-inset)', boxShadow: done ? 'none' : 'var(--inset)' }}
              />
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** How far each reader has got, against what the wheel has actually produced. */
function ReaderTotals({ progress }) {
  const { readers, totals, drawnTotal } = progress
  if (readers.length < 2 || drawnTotal === 0) return null

  return (
    <Card className="px-4 py-4">
      <p className="eyebrow">Caught up</p>
      <ul className="mt-3 space-y-3">
        {readers.map((r, i) => {
          const read = totals[r.id] ?? 0
          return (
            <li key={r.id} className="flex items-center gap-3">
              <Avatar reader={r} index={i} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm">{displayName(r, i)}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-2">
                {read}/{drawnTotal}
              </span>
              <span className="sunken block h-1.5 w-16 shrink-0 overflow-hidden rounded-full">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{
                    width: `${drawnTotal ? (read / drawnTotal) * 100 : 0}%`,
                    transition: 'width .5s var(--ease)',
                  }}
                />
              </span>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-2xs leading-relaxed text-ink-2">
        Out of the {drawnTotal} the wheel has drawn so far, not out of {TOTAL} — nobody can be
        behind on a passage that has not come up.
      </p>
    </Card>
  )
}

/** The last few days, so the run of them is visible rather than remembered. */
function RecentSpins({ rows, readers, onOpen }) {
  if (rows.length < 2) return null
  return (
    <Card as="ul" className="overflow-hidden">
      {rows.map((row, i) => {
        const entry = getEntry(row.id)
        if (!entry) return null
        const category = getCategory(entry.category)
        const done = readers.filter((r) => row.readBy?.includes(r.id))
        return (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onOpen(row)}
              className="relative flex min-h-14 w-full items-center gap-3 py-3 pr-4 pl-4 text-left"
            >
              <span
                aria-hidden="true"
                className="absolute top-1/2 left-0 h-8 w-[3px] -translate-y-1/2 rounded-r-full"
                style={{ background: category?.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif leading-snug font-semibold">{entry.topic}</span>
                <span className="block text-2xs text-ink-2">
                  {formatShortDate(row.dateISO)} · {entry.reference}
                </span>
              </span>
              <span className="shrink-0 text-2xs tabular-nums text-ink-2">
                {done.length}/{readers.length}
              </span>
            </button>
            {i < rows.length - 1 && <span aria-hidden="true" className="ml-4 block h-px bg-hairline" />}
          </li>
        )
      })}
    </Card>
  )
}

export default function NextSpin({ state, completedIds, todayRow, onOpenToday, onOpenArchive }) {
  const progress = readerProgress(state)
  const recent = byNewest(state).slice(0, 4)

  return (
    <div className="space-y-4">
      <Countdown />

      {todayRow && <TodaysSpin row={todayRow} readers={state.readers} onOpen={onOpenToday} />}

      <ProgressStrip completedIds={completedIds} />

      <ReaderTotals progress={progress} />

      {recent.length > 1 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
            <h2 className="eyebrow">Recent spins</h2>
            <Button variant="quiet" size="sm" onClick={onOpenArchive}>
              All {state.completed.length}
            </Button>
          </div>
          <RecentSpins rows={recent} readers={state.readers} onOpen={onOpenArchive} />
        </section>
      )}
    </div>
  )
}
