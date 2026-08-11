/**
 * Today's reading.
 *
 * There is no spin-again control here by design: the spin is binding, and the
 * only way back is the 60-second undo, which App owns.
 */
import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Card, Checkbox, Field, Icon, ICONS } from './ui.jsx'
import { getCategory } from '../lib/catalog.js'
import { formatLongDate } from '../lib/date.js'
import { inkOn } from '../lib/wheel.js'

const SIZE_HINT = {
  short: 'Short · under about 15 verses',
  medium: 'Medium · about a chapter',
  long: 'Long · a chapter or more',
}

/** WhatsApp understands *bold* and _italic_; this is shaped for pasting there. */
export function clipboardText(entry) {
  return [`*${entry.topic}*`, entry.reference, '', `_${entry.question}_`].join('\n')
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

  useEffect(() => {
    setDraft(row?.notes ?? '')
  }, [entry.id, row?.notes])

  useEffect(() => () => clearTimeout(debounce.current), [])

  // Notes are local while typing and flushed on a short debounce, so the card
  // stays responsive and storage is not written on every keystroke.
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
    <article className="space-y-4">
      <Card className={`px-5 py-5 ${r}`} level={4}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge style={{ background: category?.color, color: inkOn(category?.color ?? '#000'), boxShadow: 'var(--e2)' }}>
            {category?.name}
          </Badge>
          <span className="text-xs text-ink-2">{SIZE_HINT[entry.size] ?? entry.size}</span>
        </div>

        <h2
          ref={headingRef}
          tabIndex={-1}
          className="mt-3.5 font-serif text-[1.75rem] leading-[1.16] font-semibold text-balance outline-none"
        >
          {entry.topic}
        </h2>
        <p className="mt-1.5 font-serif text-lg text-ink-2">{entry.reference}</p>
        <p className="mt-2.5 text-2xs tracking-[0.05em] uppercase text-ink-2">
          {isToday ? 'Today · ' : ''}
          {formatLongDate(dateISO)}
        </p>

        <p
          className="mt-4 border-l-[3px] pl-4 font-serif leading-[1.6] text-ink-2"
          style={{ borderColor: category?.color }}
        >
          {entry.hook}
        </p>
      </Card>

      <Card className={`px-5 py-4 ${r} reveal-delay-1`}>
        <p className="eyebrow">To discuss</p>
        <p className="mt-2.5 font-serif text-xl leading-snug">{entry.question}</p>
      </Card>

      {undo && (
        <Card className="flex items-center gap-3 px-4 py-3" level={2}>
          <p className="flex-1 text-sm text-ink-2">Misclick? You can undo this spin for {undo.secondsLeft}s.</p>
          <Button variant="secondary" size="sm" onClick={onUndo}>
            <Icon path={ICONS.undo} size={16} />
            Undo
          </Button>
        </Card>
      )}

      <Card className={`px-4 py-4 ${r} reveal-delay-2`}>
        <p className="eyebrow">Read by</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Checkbox label={readerNames.a} checked={!!row?.readBy?.a} onChange={(v) => onReadBy('a', v)} className="px-1" />
          <Checkbox label={readerNames.b} checked={!!row?.readBy?.b} onChange={(v) => onReadBy('b', v)} className="px-1" />
        </div>
        <p className="mt-1.5 text-xs text-ink-2" aria-live="polite">
          {row?.readBy?.a && row?.readBy?.b
            ? 'You have both marked this as read.'
            : row?.readBy?.a
              ? `${readerNames.a} has read this. ${readerNames.b} has not yet.`
              : row?.readBy?.b
                ? `${readerNames.b} has read this. ${readerNames.a} has not yet.`
                : 'Neither of you has marked this as read yet.'}
        </p>
      </Card>

      <Card className="px-4 py-4">
        <Field
          as="textarea"
          id="notes"
          label="Notes"
          hint="Saved as you type."
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder="What came up when you talked about it…"
          rows={4}
        />
      </Card>

      <Button variant="secondary" className="w-full" onClick={copy}>
        <Icon path={ICONS.copy} size={18} />
        {copied ? 'Copied' : 'Copy for WhatsApp'}
      </Button>
    </article>
  )
}
