/**
 * Progress under the wheel: how much of the catalog is read, and a thin bar
 * per category. Colours come from the catalog.
 */
import { Card, Progress } from './ui.jsx'
import { TOTAL } from '../lib/catalog.js'
import { categoryProgress } from '../lib/stats.js'

export default function ProgressStrip({ completedIds }) {
  const read = completedIds.size
  const rows = categoryProgress(completedIds)
  const pct = Math.floor((read / TOTAL) * 100)

  return (
    <Card className="px-4 py-4" level={2}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-ink-2">
          <span className="font-serif text-xl font-semibold tabular-nums text-ink">{read}</span> of {TOTAL} read
        </p>
        <p className="text-xs tabular-nums text-ink-2">{pct}%</p>
      </div>

      <div className="mt-3">
        <Progress value={read / TOTAL} label={`${read} of ${TOTAL} passages read`} />
      </div>

      <div
        className="sunken mt-3 flex h-8 items-end gap-[3px] rounded-r2 p-[3px]"
        role="img"
        aria-label={rows.map((r) => `${r.name}: ${r.read} of ${r.total}`).join('. ')}
      >
        {rows.map((r) => (
          <div key={r.id} className="relative h-full flex-1" title={`${r.name} — ${r.read} of ${r.total}`}>
            <div
              className="absolute inset-x-0 bottom-0 rounded-[2px]"
              style={{
                height: `${Math.max(r.fraction * 100, r.read ? 10 : 0)}%`,
                background: r.color,
                transition: 'height .6s var(--ease)',
              }}
            />
          </div>
        ))}
      </div>
      <p className="mt-2 text-2xs text-ink-2">
        One bar per category · full height means that category is finished
      </p>
    </Card>
  )
}
