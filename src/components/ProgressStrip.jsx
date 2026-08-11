/**
 * The progress strip under the wheel: how much of the catalog is read, and a
 * thin bar per category. Colours come from the catalog.
 */
import { TOTAL } from '../lib/catalog.js'
import { categoryProgress } from '../lib/stats.js'

export default function ProgressStrip({ completedIds }) {
  const read = completedIds.size
  const rows = categoryProgress(completedIds)

  return (
    <div className="rounded-xl border border-line-soft bg-ground-2 p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-serif text-ink">
          <span className="text-xl">{read}</span>
          <span className="text-ink-3 text-sm"> of {TOTAL} read</span>
        </p>
        <p className="text-2xs text-ink-3 tabular-nums">{Math.floor((read / TOTAL) * 100)}%</p>
      </div>

      <div
        className="flex gap-[3px] h-8 items-end"
        role="img"
        aria-label={rows.map((r) => `${r.name}: ${r.read} of ${r.total}`).join('. ')}
      >
        {rows.map((r) => (
          <div key={r.id} className="flex-1 h-full flex flex-col justify-end" title={`${r.name} — ${r.read}/${r.total}`}>
            <div className="w-full rounded-[2px] bg-surface h-full relative overflow-hidden">
              <div
                className="absolute bottom-0 left-0 right-0 rounded-[2px] transition-[height] duration-500"
                style={{ height: `${Math.max(r.fraction * 100, r.read ? 6 : 0)}%`, background: r.color }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="text-2xs text-ink-4">One bar per category · full height means that category is finished</p>
    </div>
  )
}
