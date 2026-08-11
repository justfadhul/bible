/**
 * The Finished Side — the archive of everything already read, newest first.
 *
 * This is the view that matters long-term, so it is built to be scrolled and
 * remembered rather than tabulated: each row carries its date, its category
 * colour, and whatever was written about it.
 */
import { useMemo, useState } from 'react'
import { CATEGORIES, TOTAL, getEntry, getCategory } from '../lib/catalog.js'
import { formatShortDate } from '../lib/date.js'
import { archiveStats } from '../lib/stats.js'
import { byNewest } from '../lib/state.js'
import { readableInk } from '../lib/wheel.js'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} read`

function Stat({ value, label, sub }) {
  return (
    <div className="rounded-xl border border-line-soft bg-ground-2 px-3 py-3">
      <p className="font-serif text-2xl leading-none text-ink tabular-nums">{value}</p>
      <p className="text-2xs text-ink-3 mt-1.5 leading-tight">{label}</p>
      {sub && <p className="text-2xs text-ink-4 leading-tight">{sub}</p>}
    </div>
  )
}

function CategoryChart({ rows }) {
  // Every column is one whole category, so the fill height reads directly as
  // "how far through this category are we" — comparable across all fifteen.
  return (
    <div className="rounded-xl border border-line-soft bg-ground-2 p-4 space-y-3">
      <p className="eyebrow">Completion by category</p>
      <div
        className="flex items-end gap-1.5 h-24"
        role="img"
        aria-label={rows.map((r) => `${r.name}: ${r.read} of ${r.total}`).join('. ')}
      >
        {rows.map((r) => (
          <div key={r.id} className="relative flex-1 h-full rounded-sm bg-surface overflow-hidden" title={`${r.name} — ${r.read} of ${r.total}`}>
            <div
              className="absolute bottom-0 inset-x-0 transition-[height] duration-500"
              style={{ height: `${Math.max(r.fraction * 100, r.read ? 4 : 0)}%`, background: r.color }}
            />
          </div>
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 text-2xs sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="size-2 rounded-full shrink-0" style={{ background: r.color }} aria-hidden="true" />
            <span className="text-ink-2 truncate flex-1">{r.name}</span>
            <span className="text-ink-4 tabular-nums shrink-0">
              {r.read}/{r.total}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Row({ row, readerNames }) {
  const entry = getEntry(row.id)
  const [open, setOpen] = useState(false)
  if (!entry) return null
  const category = getCategory(entry.category)
  const both = row.readBy?.a && row.readBy?.b
  const someone = row.readBy?.a || row.readBy?.b

  return (
    <li className="relative">
      <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full" style={{ background: category?.color }} aria-hidden="true" />
      <div className="pl-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full text-left py-3 min-h-11 group"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-serif text-[1.0625rem] leading-snug text-ink flex-1">{entry.topic}</p>
            <span className="text-2xs text-ink-4 tabular-nums shrink-0">{formatShortDate(row.dateISO)}</span>
          </div>
          <p className="font-serif text-sm text-ink-2 mt-0.5">{entry.reference}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-2xs" style={{ color: readableInk(category?.color ?? '#948c7d') }}>
              {category?.name}
            </span>
            <span className="text-2xs text-ink-4">· {entry.size}</span>
            {both && <span className="text-2xs text-ink-4">· both read</span>}
            {!both && someone && (
              <span className="text-2xs text-ink-4">· {row.readBy?.a ? readerNames.a : readerNames.b} read</span>
            )}
            {row.notes?.trim() && <span className="text-2xs text-ink-4">· notes</span>}
          </div>
        </button>

        {open && (
          <div className="pb-4 space-y-3">
            <p className="font-serif text-sm leading-relaxed text-ink-2">{entry.hook}</p>
            <p className="font-serif text-sm leading-relaxed text-ink">{entry.question}</p>
            {row.notes?.trim() ? (
              <p className="rounded-lg border border-line-soft bg-ground-2 p-3 text-sm leading-relaxed text-ink-2 whitespace-pre-wrap">
                {row.notes}
              </p>
            ) : (
              <p className="text-2xs text-ink-4">No notes were written for this one.</p>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

export default function FinishedSide({ state }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [testament, setTestament] = useState('all')

  const stats = useMemo(() => archiveStats(state), [state])
  const rows = useMemo(() => byNewest(state), [state])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      const e = getEntry(row.id)
      if (!e) return false
      if (category !== 'all' && e.category !== category) return false
      if (testament !== 'all' && e.testament !== testament) return false
      if (!q) return true
      return (
        e.topic.toLowerCase().includes(q) ||
        e.reference.toLowerCase().includes(q) ||
        e.book.toLowerCase().includes(q)
      )
    })
  }, [rows, query, category, testament])

  const filtering = query.trim() || category !== 'all' || testament !== 'all'

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl text-ink">The Finished Side</h1>
        <p className="text-sm text-ink-3">Everything you have read, newest first.</p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Stat value={stats.read} label="read" sub={`${stats.remaining} to come`} />
        <Stat value={stats.current} label="day streak" sub={stats.current === 0 ? 'none yet' : 'current'} />
        <Stat value={stats.longest} label="longest" sub={plural(stats.days, 'day')} />
        <Stat value={`${Math.floor(stats.fraction * 100)}%`} label="of catalog" sub={`of ${TOTAL}`} />
        <Stat value={stats.bothRead} label="read by both" sub="ticked twice" />
        <Stat value={stats.withNotes} label="with notes" sub={`of ${stats.read || 0}`} />
      </div>

      <CategoryChart rows={stats.perCategory} />

      {/* ── filters ── */}
      <div className="space-y-2">
        <label htmlFor="archive-search" className="sr-only-live">
          Search by topic, reference or book
        </label>
        <input
          id="archive-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search topic, reference or book…"
          className="w-full min-h-11 rounded-lg border border-line-soft bg-ground-2 px-3 text-[0.9375rem]
                     text-ink placeholder:text-ink-4 focus:border-line"
        />
        <div className="flex gap-2">
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="flex-1 min-w-0 min-h-11 rounded-lg border border-line-soft bg-ground-2 px-3 text-sm text-ink"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="flex rounded-lg border border-line-soft overflow-hidden shrink-0" role="group" aria-label="Filter by testament">
            {[
              ['all', 'All'],
              ['OT', 'OT'],
              ['NT', 'NT'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTestament(value)}
                aria-pressed={testament === value}
                className={`min-h-11 px-3.5 text-sm transition-colors ${
                  testament === value ? 'bg-surface text-ink' : 'bg-ground-2 text-ink-3'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-2xs text-ink-4" aria-live="polite">
        {filtering ? `${filtered.length} of ${rows.length} shown` : `${rows.length} in the archive`}
      </p>

      {rows.length === 0 ? (
        <p className="font-serif text-ink-2 leading-relaxed py-8 text-center">
          Nothing here yet. Spin the wheel and the first passage will land on this page.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink-3 py-8 text-center">Nothing matches those filters.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {filtered.map((row) => (
            <Row key={row.id} row={row} readerNames={state.readerNames} />
          ))}
        </ul>
      )}
    </div>
  )
}
