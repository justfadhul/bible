/**
 * The passage itself, on the page.
 *
 * The whole point of the app was undermined by making people leave it: the
 * wheel hands you a reference and then you go and find it somewhere else, and
 * whatever you find there is not what this was for. So the text is here.
 *
 * Typography does the work. It is set as prose, not as a numbered list — the
 * verse numbers are small, raised and quiet, and the paragraph breaks are the
 * source edition's own, so a narrative reads as a narrative. Poetry keeps its
 * line breaks and gets a hanging indent for wrapped lines, because a psalm set
 * as a paragraph stops being a psalm.
 *
 * Chapter numbers appear only where the chapter changes, which for most
 * passages is never and for a range like "Micah 1:1-2:3" is exactly once —
 * without it, a verse 1 arriving after a verse 10 reads as a mistake.
 */
import { useEffect, useState } from 'react'
import { Card, Icon, ICONS, Skeleton } from './ui.jsx'
import { getPassage, peek, shape, TRANSLATION } from '../lib/passages.js'

/**
 * A verse number: there for anyone looking for one, out of the way otherwise.
 *
 * `ink-2` rather than the fainter `ink-3`, because these are functional text
 * that somebody genuinely reads to find their place, and ink-3 does not clear
 * AA at this size.
 */
function VerseNo({ n }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="mr-[0.15em] align-super text-[0.6em] font-semibold text-ink-2 tabular-nums select-none"
      >
        {n}
      </span>
      {/* Screen readers get the number spoken properly rather than as a digit
          jammed against the first word. */}
      <span className="sr-only-live">{` verse ${n}. `}</span>
    </>
  )
}

function Blocks({ blocks }) {
  let lastChapter = null
  let lastVerse = null
  let piecesSoFar = 0

  return (
    <div className="space-y-3.5">
      {blocks.map((block, bi) => {
        const poem = block.k === 'q'
        return (
          <p key={bi} className="font-serif text-[1.0625rem] leading-[1.75] text-ink">
            {block.v.map(([c, v, text], i) => {
              const newChapter = c !== lastChapter
              // A verse of poetry is several lines. Numbering every one of them
              // is noise — the number belongs on the line the verse starts on,
              // the way it is printed in a Bible.
              const showNumber = !poem || newChapter || v !== lastVerse
              const first = piecesSoFar === 0
              lastChapter = c
              lastVerse = v
              piecesSoFar++

              return (
                <span key={`${c}:${v}:${i}`}>
                  {newChapter && !first && (
                    <>
                      <span className="mt-3 mb-2 block h-px w-10 bg-hairline" aria-hidden="true" />
                      <span className="eyebrow mb-1.5 block">Chapter {c}</span>
                    </>
                  )}
                  {/* Poetry: one line per piece, wrapped lines indented under
                      their own first line rather than back at the margin. */}
                  {poem ? (
                    <span className={`block -indent-4 pl-4 ${showNumber ? '' : 'pl-7'}`}>
                      {showNumber ? <VerseNo n={v} /> : null}
                      {text}
                    </span>
                  ) : (
                    <>
                      <VerseNo n={v} />
                      {text}{' '}
                    </>
                  )}
                </span>
              )
            })}
          </p>
        )
      })}
    </div>
  )
}

export default function Passage({ entryId, reference, className = '', level = 3 }) {
  // Already in memory on the second and every later render, so the common case
  // paints immediately and never shows a loading state at all.
  const [passage, setPassage] = useState(() => shape(peek(entryId)))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const ready = shape(peek(entryId))
    if (ready) {
      setPassage(ready)
      setFailed(false)
      return
    }
    setPassage(null)
    setFailed(false)
    getPassage(entryId)
      .then((p) => alive && setPassage(p))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [entryId])

  if (failed) {
    return (
      <Card level={level} className={`px-5 py-5 ${className}`}>
        <p className="eyebrow">{reference}</p>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-2">
          The text could not be loaded — you are probably offline. It will be here next time you
          open the app with a connection.
        </p>
      </Card>
    )
  }

  if (!passage) {
    return (
      <Card level={level} className={`px-5 py-5 ${className}`} aria-busy="true">
        <p className="eyebrow">{reference}</p>
        <div className="mt-3.5 space-y-2.5">
          {[100, 96, 88, 98, 62].map((w, i) => (
            <Skeleton key={i} className="h-4" rounded="rounded-full" style={{ width: `${w}%` }} />
          ))}
        </div>
      </Card>
    )
  }

  return (
    <Card as="section" level={level} className={`px-5 py-5 ${className}`} aria-label={`${reference}, full text`}>
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <p className="eyebrow">{reference}</p>
        <p className="text-2xs text-ink-2">{TRANSLATION.short}</p>
      </div>

      <Blocks blocks={passage.blocks} />

      {/* A gap in the numbering with no explanation reads as a bug in the app
          rather than as a fact about the manuscripts. */}
      {passage.omitted.length > 0 && (
        <p className="mt-4 flex items-start gap-2 text-2xs leading-relaxed text-ink-2">
          <Icon path={ICONS.info} size={14} className="mt-px shrink-0" />
          <span>
            {passage.omitted.length === 1
              ? `Verse ${passage.omitted[0]} is`
              : `Verses ${passage.omitted.join(' and ')} are`}{' '}
            not in this translation — {passage.omitted.length === 1 ? 'it is' : 'they are'} in the
            King James numbering but not in the manuscripts the {TRANSLATION.name} follows.
          </span>
        </p>
      )}
    </Card>
  )
}
