/**
 * The passage itself, on the page.
 *
 * The wheel used to hand you a reference and expect you to go and find it,
 * which sent people out of the app at the exact moment it had finished doing
 * its job. So the text is here — under today's reading, and inside every
 * archive row so re-reading works too.
 *
 * It comes from bible-api.com and from nowhere else. There is no bundled copy
 * behind it any more, so this component has a real failure state rather than a
 * decorative one: no connection and nothing cached means a message and a retry
 * button where the text should be. Quietly substituting a different translation
 * would be worse, because a passage on this screen is something somebody might
 * write down or quote.
 *
 * Typography does what it can. The API returns a flat verse list, so a passage
 * is one continuous block per chapter with no paragraph breaks — the verse
 * numbers are small, raised and quiet so it still reads as prose rather than as
 * a numbered list. Chapter numbers appear only where the chapter changes, which
 * is where a verse 1 arriving after a verse 10 would otherwise read as a
 * mistake.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Icon, ICONS, Skeleton } from './ui.jsx'
import { fetchPassage, findTranslation, DEFAULT_TRANSLATION } from '../lib/bibleApi.js'

/**
 * A verse number: there for anyone looking for one, out of the way otherwise.
 *
 * `ink-2` rather than the fainter `ink-3`, because these are functional text
 * somebody reads to find their place, and ink-3 does not clear AA at this size.
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
  let piecesSoFar = 0

  return (
    <div className="space-y-3.5">
      {blocks.map((block, bi) => (
        <p key={bi} className="font-serif text-[1.0625rem] leading-[1.75] text-ink">
          {block.v.map(([c, v, text], i) => {
            const newChapter = c !== lastChapter
            const first = piecesSoFar === 0
            lastChapter = c
            piecesSoFar++

            return (
              <span key={`${c}:${v}:${i}`}>
                {newChapter && !first && (
                  <>
                    <span className="mt-3 mb-2 block h-px w-10 bg-hairline" aria-hidden="true" />
                    <span className="eyebrow mb-1.5 block">Chapter {c}</span>
                  </>
                )}
                <VerseNo n={v} />
                {text}{' '}
              </span>
            )
          })}
        </p>
      ))}
    </div>
  )
}

export default function Passage({
  entryId,
  reference,
  className = '',
  level = 3,
  translationId = DEFAULT_TRANSLATION,
}) {
  const wanted = findTranslation(translationId)
  const [state, setState] = useState({ kind: 'loading' })
  // Bumped by Try again — the only way to ask a second time for the same thing.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    fetchPassage(reference, wanted.id)
      .then((r) => alive && setState({ kind: 'ready', blocks: r.blocks, translation: r.translation }))
      .catch(() => alive && setState({ kind: 'failed' }))
    return () => {
      alive = false
    }
    // entryId is a dependency so two readings of one reference still refetch.
    // It cannot happen with this catalog, but a component keyed on the wrong
    // thing is a bug waiting for a catalog edit.
  }, [entryId, reference, wanted.id, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const header = (
    <div className="mb-3.5 flex items-baseline justify-between gap-3">
      <p className="eyebrow">{reference}</p>
      <p className="text-2xs text-ink-2">{wanted.short}</p>
    </div>
  )

  if (state.kind === 'failed') {
    return (
      <Card level={level} className={`px-5 py-5 ${className}`}>
        {header}
        <p className="text-sm leading-relaxed text-ink-2">
          The text could not be fetched. Each passage is downloaded the first time you open it and
          kept on this device afterwards, so this is almost always the connection — the reference
          above is still what came up today.
        </p>
        <div className="mt-3.5">
          <Button variant="secondary" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      </Card>
    )
  }

  if (state.kind === 'loading') {
    return (
      <Card level={level} className={`px-5 py-5 ${className}`} aria-busy="true">
        {header}
        <div className="space-y-2.5">
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
        <p className="text-2xs text-ink-2">{state.translation.short}</p>
      </div>

      <Blocks blocks={state.blocks} />

      {/* A few verses are in the King James numbering but not in the
          manuscripts most modern translations follow. A gap in the numbering is
          therefore a fact about the text, and saying nothing would leave it
          looking like the app lost something on the way. */}
      <p className="mt-4 flex items-start gap-2 text-2xs leading-relaxed text-ink-2">
        <Icon path={ICONS.info} size={14} className="mt-px shrink-0" />
        <span>
          {state.translation.name}. A missing verse number is a verse this translation does not
          have, not one that failed to arrive.
        </span>
      </p>
    </Card>
  )
}
