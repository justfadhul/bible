/**
 * The Finished Side — the archive of everything already read, newest first.
 *
 * This is the view that matters long-term, so it is built to be scrolled and
 * remembered rather than tabulated: each row carries its date, its category
 * colour, and whatever was written about it.
 */
import { useMemo, useState } from 'react'
import { Card, EmptyState, Field, Icon, ICONS, Inset, Segmented } from './ui.jsx'
import { CATEGORIES, TOTAL, getEntry, getCategory } from '../lib/catalog.js'
import { formatShortDate } from '../lib/date.js'
import { archiveStats } from '../lib/stats.js'
import { byNewest } from '../lib/state.js'
import { readableInk } from '../lib/wheel.js'
import { useMediaQuery } from '../hooks/useMedia.js'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} read`

function Stat({ value, label, sub }) {
  return (
    <Card className="px-3.5 py-3" level={2}>
      <p className="font-serif text-2xl leading-none font-semibold tabular-nums">{value}</p>
      <p className="mt-2 text-2xs leading-tight text-ink-2">{label}</p>
      {sub && <p className="text-2xs leading-tight text-ink-2">{sub}</p>}
    </Card>
  )
}

function CategoryChart({ rows }) {
  // Every column is one whole category, so the fill height reads directly as
  // "how far through this category are we" — comparable across all fifteen.
  return (
    <Card className="px-4 py-4">
      <p className="eyebrow">Completion by category</p>
      <Inset
        className="mt-3 flex h-28 items-end gap-1.5 p-1.5"
        role="img"
        aria-label={rows.map((r) => `${r.name}: ${r.read} of ${r.total}`).join('. ')}
      >
        {rows.map((r) => (
          <div key={r.id} className="relative h-full flex-1" title={`${r.name} — ${r.read} of ${r.total}`}>
            <div
              className="absolute inset-x-0 bottom-0 rounded-[3px]"
              style={{
                height: `${Math.max(r.fraction * 100, r.read ? 5 : 0)}%`,
                background: r.color,
                transition: 'height .6s var(--ease)',
              }}
            />
          </div>
        ))}
      </Inset>
      <ul className="mt-4 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden="true" />
            <span className="flex-1 truncate text-ink-2">{r.name}</span>
            <span className="shrink-0 tabular-nums text-ink-2">
              {r.read}/{r.total}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Row({ row, readerNames, ground, last }) {
  const entry = getEntry(row.id)
  const [open, setOpen] = useState(false)
  if (!entry) return null
  const category = getCategory(entry.category)
  const both = row.readBy?.a && row.readBy?.b
  const someone = row.readBy?.a || row.readBy?.b

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="relative w-full py-3.5 pr-3 pl-4 text-left"
      >
        <span
          aria-hidden="true"
          className="absolute top-4 left-0 h-9 w-[3px] rounded-r-full"
          style={{ background: category?.color }}
        />
        <span className="flex items-baseline justify-between gap-3">
          <span className="flex-1 font-serif leading-snug font-semibold">{entry.topic}</span>
          <span className="shrink-0 text-2xs tabular-nums text-ink-2">{formatShortDate(row.dateISO)}</span>
        </span>
        <span className="mt-0.5 block font-serif text-sm text-ink-2">{entry.reference}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-2xs">
          <span className="font-semibold" style={{ color: readableInk(category?.color ?? '#888888', ground) }}>
            {category?.name}
          </span>
          <span className="text-ink-2">· {entry.size}</span>
          {both && <span className="text-ink-2">· both read</span>}
          {!both && someone && (
            <span className="text-ink-2">· {row.readBy?.a ? readerNames.a : readerNames.b} read</span>
          )}
          {row.notes?.trim() && <span className="text-ink-2">· notes</span>}
        </span>
      </button>

      {open && (
        <div className="space-y-2.5 px-4 pb-4">
          <p className="font-serif text-sm leading-relaxed text-ink-2">{entry.hook}</p>
          <p className="font-serif text-sm leading-relaxed">{entry.question}</p>
          {row.notes?.trim() ? (
            <Inset className="p-3 text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{row.notes}</Inset>
          ) : (
            <p className="text-2xs text-ink-2">No notes were written for this one.</p>
          )}
        </div>
      )}

      {!last && <span aria-hidden="true" className="ml-4 block h-px bg-hairline" />}
    </li>
  )
}

export default function FinishedSide({ state }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [testament, setTestament] = useState('all')

  // The archive rows sit on a raised surface, so that is the ground the
  // category name has to stay legible against.
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const explicit = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null
  const dark = explicit ? explicit === 'dark' : prefersDark
  const ground = dark ? '#2b2721' : '#f5f1e9'

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
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        <Stat value={stats.read} label="read" sub={`${stats.remaining} to come`} />
        <Stat value={stats.current} label="day streak" sub={stats.current === 0 ? 'none yet' : 'current'} />
        <Stat value={stats.longest} label="longest" sub={plural(stats.days, 'day')} />
        <Stat value={`${Math.floor(stats.fraction * 100)}%`} label="of catalog" sub={`of ${TOTAL}`} />
        <Stat value={stats.bothRead} label="read by both" sub="ticked twice" />
        <Stat value={stats.withNotes} label="with notes" sub={`of ${stats.read || 0}`} />
      </div>

      <CategoryChart rows={stats.perCategory} />

      {/* ── filters ── */}
      <div className="space-y-2.5">
        <Field
          id="archive-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Topic, reference or book"
          icon={<Icon path={ICONS.search} size={18} />}
        />

        <div className="flex gap-2.5">
          <div className="sunken min-w-0 flex-1 rounded-r3">
            <select
              aria-label="Filter by category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="min-h-11 w-full rounded-r3 bg-transparent px-3 text-sm focus:outline-none"
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <Segmented
            label="Filter by testament"
            value={testament}
            onChange={setTestament}
            className="w-[9.5rem] shrink-0"
            options={[
              { value: 'all', label: 'All' },
              { value: 'OT', label: 'OT' },
              { value: 'NT', label: 'NT' },
            ]}
          />
        </div>
      </div>

      <p className="px-1 text-2xs text-ink-2" aria-live="polite">
        {filtering ? `${filtered.length} of ${rows.length} shown` : `${rows.length} in the archive`}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          body="Spin the wheel and the first passage will land on this page."
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No results found" body="Nothing matches those filters." />
      ) : (
        <Card as="ul" className="overflow-hidden">
          {filtered.map((row, i) => (
            <Row
              key={row.id}
              row={row}
              readerNames={state.readerNames}
              ground={ground}
              last={i === filtered.length - 1}
            />
          ))}
        </Card>
      )}
    </div>
  )
}
