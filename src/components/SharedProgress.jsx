/**
 * Who has read what — the two of you, side by side, category by category.
 *
 * A table because it genuinely is one: readers across, categories down. The
 * shape is the point. Two columns of numbers next to each other answers "are
 * we in step" at a glance, in a way that two separate progress screens never
 * could, and expanding a category keeps the same columns so the detail lines
 * up under the summary rather than restating it in a different arrangement.
 *
 * The ticks inside are live. Ticking a past reading was previously impossible
 * — only today's card had checkboxes — so anyone who read Tuesday's passage on
 * Wednesday had nowhere to say so, and the other reader saw a gap that was not
 * real. Fixing that here costs one prop and makes the view worth opening even
 * when you are not comparing.
 */
import { useState } from 'react'
import { Avatar, Card, EmptyState, Icon, ICONS } from './ui.jsx'
import { displayName } from '../lib/readers.js'
import { formatShortDate } from '../lib/date.js'

/** A reader's score in one category, as a number over a bar. */
function Score({ read, of, color }) {
  const fraction = of ? read / of : 0
  const complete = of > 0 && read === of
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className={`text-xs tabular-nums ${complete ? 'font-semibold text-ink' : 'text-ink-2'}`}>
        {of === 0 ? '—' : `${read}/${of}`}
      </span>
      <span className="sunken block h-1.5 w-10 overflow-hidden rounded-full">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${fraction * 100}%`,
            background: color,
            transition: 'width .5s var(--ease)',
          }}
        />
      </span>
    </div>
  )
}

function CategoryBlock({ category, readers, onReadBy, colWidth }) {
  const [open, setOpen] = useState(false)
  const nothingYet = category.drawn === 0

  return (
    <>
      <tr>
        <th scope="row" className="p-0 text-left font-normal">
          <button
            type="button"
            onClick={() => !nothingYet && setOpen((o) => !o)}
            aria-expanded={nothingYet ? undefined : open}
            disabled={nothingYet}
            className="flex min-h-14 w-full items-center gap-2.5 py-2 pr-2 pl-1 text-left disabled:cursor-default"
          >
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: category.color, opacity: nothingYet ? 0.35 : 1 }}
            />
            <span className="min-w-0 flex-1">
              <span className={`block text-sm leading-tight ${nothingYet ? 'text-ink-2' : 'text-ink'}`}>
                {category.name}
              </span>
              <span className="block text-2xs text-ink-2">
                {nothingYet ? `none of ${category.total} drawn yet` : `${category.drawn} of ${category.total} drawn`}
              </span>
            </span>
            {!nothingYet && (
              <Icon
                path={ICONS.chevron}
                size={16}
                className="shrink-0 text-ink-3"
                style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .3s var(--ease)' }}
              />
            )}
          </button>
        </th>
        {readers.map((r, i) => (
          <td key={r.id} className="px-1 py-2 text-center align-middle" style={{ width: colWidth }}>
            <Score read={category.perReader[r.id] ?? 0} of={category.drawn} color={category.color} />
          </td>
        ))}
      </tr>

      {open &&
        category.topics.map((t) => (
          <tr key={t.id}>
            <td className="py-1 pr-2 pl-6">
              <span className="block text-sm leading-snug">{t.topic}</span>
              <span className="block text-2xs text-ink-2">
                {t.reference} · {formatShortDate(t.dateISO)}
                {t.hasNotes ? ' · notes' : ''}
              </span>
            </td>
            {readers.map((r, i) => {
              const on = t.readBy.includes(r.id)
              return (
                <td key={r.id} className="px-1 py-1 text-center">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`${displayName(r, i)} has read ${t.topic}`}
                    onClick={() => onReadBy?.(t.id, r.id, !on)}
                    className="mx-auto grid size-11 place-items-center rounded-r3"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-6 place-items-center rounded-r2"
                      style={{
                        background: on ? category.color : 'var(--surface-inset)',
                        boxShadow: on ? 'var(--e2)' : 'var(--inset)',
                        transition: 'background-color .24s var(--ease)',
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                        <path
                          d={ICONS.check}
                          pathLength="1"
                          strokeDasharray="1"
                          style={{ strokeDashoffset: on ? 0 : 1, transition: 'stroke-dashoffset .3s var(--ease)' }}
                        />
                      </svg>
                    </span>
                  </button>
                </td>
              )
            })}
          </tr>
        ))}

      {open && category.undrawn > 0 && (
        <tr>
          <td colSpan={readers.length + 1} className="pt-1 pb-3 pl-6 text-2xs text-ink-2">
            {category.undrawn} more still in the pool — the wheel has not reached them.
          </td>
        </tr>
      )}
    </>
  )
}

export default function SharedProgress({ progress, onReadBy }) {
  const { readers, categories, totals, drawnTotal } = progress

  if (drawnTotal === 0) {
    return (
      <EmptyState
        title="Nothing to compare yet"
        body="Once the wheel has produced a passage or two, this is where you can see who has caught up."
      />
    )
  }

  // Two readers is the case this exists for, so two must fit inside 380px
  // without scrolling — the whole value is seeing both columns at once. Beyond
  // three the table scrolls sideways rather than crushing the category names.
  const colWidth = readers.length > 3 ? 64 : 72
  const NAME_COL = 152

  return (
    <Card className="px-2 py-2">
      <div className="overflow-x-auto">
        <table className="w-full" style={{ minWidth: NAME_COL + readers.length * colWidth }}>
          <caption className="sr-only-live">
            How many of the passages drawn so far each reader has read, by category
          </caption>
          <thead>
            <tr>
              <td />
              {readers.map((r, i) => (
                <th key={r.id} scope="col" className="px-1 pt-1 pb-2" style={{ width: colWidth }}>
                  <span className="flex flex-col items-center gap-1.5">
                    <Avatar reader={r} index={i} size={34} />
                    <span className="block max-w-[4.5rem] truncate text-2xs font-semibold text-ink">
                      {displayName(r, i)}
                    </span>
                    <span className="block text-2xs tabular-nums text-ink-2">
                      {totals[r.id] ?? 0}/{drawnTotal}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <CategoryBlock
                key={c.id}
                category={c}
                readers={readers}
                onReadBy={onReadBy}
                colWidth={colWidth}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
