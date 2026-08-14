/**
 * Today's reading.
 *
 * There is no spin-again control here by design: the spin is binding, and the
 * only way back is the 60-second undo, which App owns.
 */
import { useEffect, useRef, useState } from 'react'
import { Avatar, Badge, Button, Card, Field, Icon, ICONS, Inset } from './ui.jsx'
import Passage from './Passage.jsx'
import { displayName } from '../lib/readers.js'
import * as haptics from '../lib/haptics.js'
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
  readers,
  meId,
  translationId,
  onNotes,
  onReadBy,
  undo,
  onUndo,
  isToday = true,
  animate = true,
}) {
  const category = getCategory(entry.category)
  const readCount = row?.readBy?.length ?? 0

  // Everyone except you, split by whether they have written anything.
  const others = readers.map((r, index) => ({ reader: r, index })).filter(({ reader }) => reader.id !== meId)
  const theirNotes = others
    .map((o) => ({ ...o, text: row?.notesBy?.[o.reader.id] ?? '' }))
    .filter((o) => o.text.trim())
  const waitingOn = others
    .filter(({ reader }) => !row?.notesBy?.[reader.id]?.trim())
    .map(({ reader, index }) => displayName(reader, index))
  const [draft, setDraft] = useState(row?.notesBy?.[meId] ?? '')
  const [copied, setCopied] = useState(false)
  // 'Saved as you type' is a promise; this is the evidence. Without it there
  // is no moment where the note visibly stops being unsaved, which is exactly
  // when people copy their text out somewhere safer before closing the tab.
  const [saved, setSaved] = useState('idle') // idle | pending | done
  const debounce = useRef(null)
  const savedFor = useRef(null)
  const headingRef = useRef(null)

  useEffect(() => {
    setDraft(row?.notesBy?.[meId] ?? '')
  }, [entry.id, meId, row?.notesBy?.[meId]])

  // Notes are local while typing and flushed on a short debounce, so the card
  // stays responsive and storage is not written on every keystroke.
  const pending = useRef(null)
  const commitRef = useRef(null)

  // Leaving the card — another tab, or the day rolling over — is the same
  // problem as leaving the app: whatever is still in the debounce goes now.
  useEffect(
    () => () => {
      commitRef.current?.()
      clearTimeout(debounce.current)
      clearTimeout(savedFor.current)
    },
    [],
  )

  const commitDraft = () => {
    if (pending.current === null) return
    const value = pending.current
    pending.current = null
    clearTimeout(debounce.current)
    onNotes(value)
    setSaved('done')
    clearTimeout(savedFor.current)
    savedFor.current = setTimeout(() => setSaved('idle'), 1800)
  }
  commitRef.current = commitDraft

  const onDraft = (value) => {
    setDraft(value)
    setSaved('pending')
    pending.current = value
    clearTimeout(debounce.current)
    debounce.current = setTimeout(commitDraft, 350)
  }

  /**
   * A third of a second is nothing to type through and everything to lose a
   * sentence in. Backgrounding the app, closing the tab or switching away
   * mid-thought all land inside that window, so they commit the draft
   * immediately rather than letting the timer decide whether it survives.
   */
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') commitDraft()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', commitDraft)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', commitDraft)
    }
  })

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

      {/* The passage itself, before the question about it — you cannot discuss
          what you have not read, and the old order sent people out of the app
          to find the text and back again to find the question. */}
      <Passage
        entryId={entry.id}
        reference={entry.reference}
        translationId={translationId}
        className={`${r} reveal-delay-1`}
      />

      <Card className={`px-5 py-4 ${r} reveal-delay-2`}>
        <p className="eyebrow">To discuss</p>
        <p className="mt-2.5 font-serif text-xl leading-snug">{entry.question}</p>
      </Card>

      {undo && (
        <Card className="flex items-center gap-3 px-4 py-3" level={2}>
          <p className="flex-1 text-sm text-ink-2">Misclick? You can undo this spin for {undo.secondsLeft}s.</p>
          <Button variant="secondary" size="sm" onClick={() => { haptics.tap(); onUndo() }}>
            <Icon path={ICONS.undo} size={16} />
            Undo
          </Button>
        </Card>
      )}

      <Card className={`px-4 py-4 ${r} reveal-delay-3`}>
        <p className="eyebrow">Read by</p>
        <ul className="mt-2.5 space-y-1.5">
          {readers.map((reader, i) => {
            const on = row?.readBy?.includes(reader.id)
            return (
              <li key={reader.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={!!on}
                  onClick={() => {
                    haptics.toggle()
                    onReadBy(reader.id, !on)
                  }}
                  className="flex min-h-12 w-full items-center gap-3 rounded-r3 px-2 text-left"
                  style={on ? { background: 'var(--accent-soft)' } : undefined}
                >
                  <Avatar reader={reader} index={i} size={34} />
                  <span className={`min-w-0 flex-1 truncate ${on ? 'font-semibold' : 'text-ink-2'}`}>
                    {displayName(reader, i)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded-r2"
                    style={{
                      background: on ? 'var(--accent)' : 'var(--surface-inset)',
                      boxShadow: on ? 'var(--e2)' : 'var(--inset), inset 0 0 0 1px var(--hairline-strong)',
                      transition: 'background-color .24s var(--ease), box-shadow .24s var(--ease)',
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--accent-ink)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <path
                        d={ICONS.check}
                        pathLength="1"
                        strokeDasharray="1"
                        style={{ strokeDashoffset: on ? 0 : 1, transition: 'stroke-dashoffset .32s var(--ease) .04s' }}
                      />
                    </svg>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 px-1 text-xs text-ink-2" aria-live="polite">
          {readCount === 0
            ? 'Nobody has marked this as read yet.'
            : readCount === readers.length
              ? `All ${readers.length} of you have read this.`
              : `${readCount} of ${readers.length} have read this.`}
        </p>
      </Card>

      <Card className={`px-4 py-4 ${r} reveal-delay-3`}>
        <Field
          as="textarea"
          id="notes"
          label="Your note"
          hint={
            saved === 'pending' ? 'Saving…' : saved === 'done' ? 'Saved.' : 'Saved as you type.'
          }
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder="What came up when you read it…"
          rows={4}
        />

        {/* What the others made of the same passage. Read-only and attributed:
            the point of a shared history is seeing the other person's take, and
            a single box everyone typed into could only ever show one of them. */}
        {theirNotes.map(({ reader, index, text }) => (
          <div key={reader.id} className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <Avatar reader={reader} index={index} size={22} />
              <p className="eyebrow">{displayName(reader, index)}</p>
            </div>
            <Inset className="p-3 text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{text}</Inset>
          </div>
        ))}

        {/* Written before notes were per-reader, so nobody knows whose it is.
            Attributing it to somebody would be a guess written into their
            history, so it stays unsigned and nothing new is ever added here. */}
        {row?.notes?.trim() && (
          <div className="mt-4">
            <p className="eyebrow mb-2">Note from before</p>
            <Inset className="p-3 text-sm leading-relaxed whitespace-pre-wrap text-ink-2">
              {row.notes}
            </Inset>
          </div>
        )}

        {waitingOn.length > 0 && (
          <p className="mt-3.5 px-1 text-xs leading-relaxed text-ink-2">
            {waitingOn.length === 1
              ? `${waitingOn[0]} has not written anything about this one yet.`
              : `${waitingOn.slice(0, -1).join(', ')} and ${waitingOn.at(-1)} have not written anything about this one yet.`}
          </p>
        )}
      </Card>

      <Button variant="secondary" className="w-full" onClick={() => { haptics.tap(); copy() }}>
        <Icon path={ICONS.copy} size={18} />
        {copied ? 'Copied' : 'Copy for WhatsApp'}
      </Button>
    </article>
  )
}
