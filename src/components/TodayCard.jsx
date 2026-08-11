/**
 * Today's reading.
 *
 * There is no spin-again control here by design: the spin is binding, and the
 * only way back is the 60-second undo, which App owns.
 */
import { useEffect, useRef, useState } from 'react'
import { getCategory } from '../lib/catalog.js'
import { formatLongDate } from '../lib/date.js'
import { inkOn } from '../lib/wheel.js'

const SIZE_HINT = {
  short: 'Short — under about 15 verses',
  medium: 'Medium — about a chapter',
  long: 'Long — a chapter or more',
}

/** WhatsApp understands *bold* and _italic_; this is shaped for pasting there. */
export function clipboardText(entry) {
  return [`*${entry.topic}*`, entry.reference, '', `_${entry.question}_`].join('\n')
}

function ReaderCheck({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-3 min-h-11 px-3 rounded-lg border border-line-soft bg-ground-2 flex-1 cursor-pointer has-checked:border-line has-checked:bg-surface transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 shrink-0 accent-ink"
      />
      <span className={`text-sm truncate ${checked ? 'text-ink' : 'text-ink-2'}`}>{label}</span>
    </label>
  )
}

export default function TodayCard({
  entry,
  row,
  dateISO,
  readerNames,
  onNotes,
  onReadBy,
  undo,
  onUndo,
  isToday = true,
  animate = true,
}) {
  const category = getCategory(entry.category)
  const [draft, setDraft] = useState(row?.notes ?? '')
  const [copied, setCopied] = useState(false)
  const debounce = useRef(null)
  const headingRef = useRef(null)

  // Notes are local while typing and flushed on a short debounce, so the card
  // stays responsive and storage is not written on every keystroke.
  useEffect(() => {
    setDraft(row?.notes ?? '')
  }, [entry.id, row?.notes])

  useEffect(() => () => clearTimeout(debounce.current), [])

  const onDraft = (value) => {
    setDraft(value)
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => onNotes(value), 350)
  }

  // Move focus to the result so a keyboard or screen-reader user lands on it.
  useEffect(() => {
    if (animate) headingRef.current?.focus({ preventScroll: false })
  }, [entry.id, animate])

  const copy = async () => {
    const text = clipboardText(entry)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Older iOS Safari and non-secure contexts have no clipboard API.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* nothing more to try */ }
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const r = animate ? 'reveal' : ''

  return (
    <article className="space-y-6">
      <header className={`space-y-3 ${r}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-2xs font-semibold tracking-wide uppercase"
            style={{ background: category?.color, color: inkOn(category?.color ?? '#000') }}
          >
            {category?.name}
          </span>
          <span className="text-2xs text-ink-3">{SIZE_HINT[entry.size] ?? entry.size}</span>
        </div>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-serif text-[1.75rem] leading-[1.15] text-ink outline-none"
        >
          {entry.topic}
        </h1>
        <p className="font-serif text-lg text-ink-2">{entry.reference}</p>
        <p className="text-2xs text-ink-4">
          {isToday ? "Today's reading · " : ''}
          {formatLongDate(dateISO)}
        </p>
      </header>

      <p className={`font-serif text-[1.0625rem] leading-relaxed text-ink-2 border-l-2 pl-4 ${r} reveal-delay-1`}
         style={{ borderColor: category?.color }}>
        {entry.hook}
      </p>

      <section className={`rounded-xl border border-line-soft bg-ground-2 p-4 space-y-2 ${r} reveal-delay-2`}>
        <p className="eyebrow">To discuss</p>
        <p className="font-serif text-lg leading-snug text-ink">{entry.question}</p>
      </section>

      {undo && (
        <div className="rounded-xl border border-line bg-surface p-3 flex items-center gap-3">
          <p className="text-xs text-ink-2 flex-1">
            Misclick? You can undo this spin for {undo.secondsLeft}s.
          </p>
          <button
            type="button"
            onClick={onUndo}
            className="min-h-11 px-4 rounded-lg border border-line text-sm text-ink hover:bg-surface-2 transition-colors"
          >
            Undo
          </button>
        </div>
      )}

      <section className={`space-y-3 ${r} reveal-delay-3`}>
        <p className="eyebrow">Read by</p>
        <div className="flex gap-2">
          <ReaderCheck label={readerNames.a} checked={!!row?.readBy?.a} onChange={(v) => onReadBy('a', v)} />
          <ReaderCheck label={readerNames.b} checked={!!row?.readBy?.b} onChange={(v) => onReadBy('b', v)} />
        </div>
        <p className="text-2xs text-ink-4" aria-live="polite">
          {row?.readBy?.a && row?.readBy?.b
            ? 'You have both marked this as read.'
            : row?.readBy?.a
              ? `${readerNames.a} has read this. ${readerNames.b} has not yet.`
              : row?.readBy?.b
                ? `${readerNames.b} has read this. ${readerNames.a} has not yet.`
                : 'Neither of you has marked this as read yet.'}
        </p>
      </section>

      <section className="space-y-2">
        <label htmlFor="notes" className="eyebrow block">
          Notes
        </label>
        <textarea
          id="notes"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder="What came up when you talked about it…"
          rows={4}
          className="w-full rounded-xl border border-line-soft bg-ground-2 p-3 text-[0.9375rem] leading-relaxed
                     text-ink placeholder:text-ink-4 resize-y min-h-24 focus:border-line"
        />
        <p className="text-2xs text-ink-4">Saved as you type.</p>
      </section>

      <button
        type="button"
        onClick={copy}
        className="w-full min-h-12 rounded-full border border-line text-sm text-ink
                   hover:bg-surface active:scale-[0.985] transition-[transform,background-color]"
      >
        {copied ? 'Copied' : 'Copy for WhatsApp'}
      </button>
    </article>
  )
}
