/**
 * Who else is here.
 *
 * This replaced the eight-character invite code, and the difference is not
 * cosmetic: a code is a secret one person has to read aloud to another, and
 * this is a list of people who are already here. Nobody has to transcribe
 * anything.
 *
 * A friendship is not a reading group — not yet. Adding somebody lets the two
 * of you see each other: name, photo, whether they are about, and how far
 * through the catalog they have got. It gives nobody access to anybody's
 * readings or notes, and the footer says so plainly rather than letting the
 * word "friend" imply more than it does.
 */
import { useState } from 'react'
import { Alert, Avatar, Badge, Button, Card, Icon, ICONS, Spinner } from './ui.jsx'
import { TOTAL } from '../lib/catalog.js'

const MINUTE = 60_000
const HERE_NOW_MS = 5 * MINUTE

/**
 * What to call somebody.
 *
 * Deliberately not readers.js's displayName(): that falls back to "Reader B"
 * for an account with no published name, which is exactly the phantom this app
 * spent two rounds getting rid of. A real person with an empty profile is
 * better identified by a hint of the address they signed up with than by a
 * letter of the alphabet.
 */
export function personLabel(person) {
  const chosen = person?.name?.trim()
  if (chosen) return chosen
  if (person?.email) return person.email.split('@')[0]
  if (person?.emailHint) return person.emailHint
  return 'Someone'
}

/**
 * What the fallback avatar should letter itself from.
 *
 * The label can be a masked address, and initials() taking its first two
 * characters produces "E•" — a bullet is not an initial. So the avatar is
 * given the part of the label that is actually a name.
 */
export function avatarName(person) {
  const label = personLabel(person)
  return label.includes('•') ? label.charAt(0) : label
}

/** "Here now", or how long ago, or the honest absence of an answer. */
export function lastSeen(seenAt, now = Date.now()) {
  if (!seenAt) return 'Not opened the app yet'
  const ms = now - Date.parse(seenAt)
  if (!Number.isFinite(ms)) return ''
  if (ms < HERE_NOW_MS) return 'Here now'
  const mins = Math.round(ms / MINUTE)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'Yesterday' : `${days}d ago`
}

const ACTION = {
  none: 'Add friend',
  incoming: 'Accept',
  outgoing: 'Asked',
  friend: 'Friends',
}

function PersonRow({ person, busy, onAdd, onRemove }) {
  const [confirming, setConfirming] = useState(false)
  const here = person.seenAt && Date.now() - Date.parse(person.seenAt) < HERE_NOW_MS
  const label = personLabel(person)

  // Somebody already in your reading group is a friend for every practical
  // purpose, but there is no friendship row to delete — so offering Remove
  // would be offering a button that does nothing.
  const removable = person.relation !== 'none' && !person.inMyGroup

  const subtitle =
    person.relation === 'friend' ? (
      <>
        {lastSeen(person.seenAt)}
        {typeof person.readCount === 'number' && (
          <> · {person.readCount} of {TOTAL} read</>
        )}
      </>
    ) : person.relation === 'incoming' ? (
      'Would like to be friends'
    ) : (
      // An outgoing row carries an "Asked" badge already, so repeating it in
      // words here only cost the line the width it needed to say anything.
      lastSeen(person.seenAt)
    )

  /**
   * Two controls go on their own line rather than beside the name.
   *
   * At 380px a Decline and an Accept leave about eleven characters for the
   * person, which is how "Would like to be friends" became "Would lik…" and a
   * masked address lost its domain. The name is the part of the row you are
   * reading; the buttons can have the width instead of taking it.
   */
  const stacked = confirming || person.relation === 'incoming'

  const controls = confirming ? (
    <>
      <Button variant="secondary" size="sm" className="flex-1" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <Button
        size="sm"
        className="flex-1"
        style={{ background: 'var(--danger)', color: '#fff', boxShadow: 'var(--e3)' }}
        onClick={() => {
          setConfirming(false)
          onRemove(person)
        }}
      >
        Remove
      </Button>
    </>
  ) : person.relation === 'incoming' ? (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="flex-1"
        disabled={busy}
        aria-label={`Decline ${label}`}
        onClick={() => onRemove(person)}
      >
        Decline
      </Button>
      <Button size="sm" className="flex-1" disabled={busy} busy={busy} onClick={() => onAdd(person)}>
        Accept
      </Button>
    </>
  ) : person.relation === 'friend' || person.relation === 'outgoing' ? (
    <>
      {/* No "Friends" badge under a heading that already says Friends — it
          was costing the row the width that "41 of 286 read" needs, and the
          progress is the part worth reading. "Reading together" is not
          redundant, because it is why there is no Remove button. */}
      {(person.inMyGroup || person.relation === 'outgoing') && (
        <Badge tone={person.inMyGroup ? 'accent' : 'neutral'}>
          {person.inMyGroup ? 'Reading together' : ACTION.outgoing}
        </Badge>
      )}
      {removable && (
        <Button
          variant="quiet"
          size="sm"
          aria-label={`Remove ${label}`}
          onClick={() => setConfirming(true)}
        >
          <Icon path="M6 6l12 12M18 6 6 18" size={16} />
        </Button>
      )}
    </>
  ) : (
    <Button variant="secondary" size="sm" disabled={busy} busy={busy} onClick={() => onAdd(person)}>
      {ACTION.none}
    </Button>
  )

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className="relative shrink-0">
          <Avatar reader={{ ...person, name: avatarName(person) }} index={0} size={44} />
          {here && (
            <span
              aria-hidden="true"
              className="absolute right-0 bottom-0 size-3 rounded-full border-2"
              style={{ background: 'var(--ok)', borderColor: 'var(--surface-raised)' }}
            />
          )}
        </span>

        <div className="min-w-0 flex-1">
          {/* Wraps rather than truncates: a masked address is mostly bullets
              already, and "e•••@gmail.c…" is not enough left of somebody to
              recognise them by. The line beneath may truncate — it is a
              detail, and the name is the row. */}
          <p className="font-semibold break-words leading-snug">{label}</p>
          <p className="truncate text-xs text-ink-2">{subtitle}</p>
        </div>

        {!stacked && <span className="flex shrink-0 items-center gap-2">{controls}</span>}
      </div>

      {stacked && <div className="mt-2.5 flex gap-2 pl-[56px]">{controls}</div>}
    </li>
  )
}

export default function People({ sync }) {
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  if (!sync?.enabled || !sync.session) return null

  const people = sync.people
  const loading = people === null

  const run = async (person, fn, after) => {
    setBusyId(person.id)
    setError(null)
    setNotice(null)
    try {
      const outcome = await fn()
      if (after) setNotice(after(outcome, person))
    } catch (e) {
      setError(e?.message ?? String(e))
    } finally {
      setBusyId(null)
    }
  }

  const incoming = (people ?? []).filter((p) => p.relation === 'incoming')
  const friends = (people ?? []).filter((p) => p.relation === 'friend')
  const rest = (people ?? []).filter((p) => p.relation === 'none' || p.relation === 'outgoing')

  const Section = ({ title, rows }) =>
    rows.length ? (
      <>
        <p className="eyebrow mt-4 mb-1 first:mt-0">{title}</p>
        <ul className="divide-y divide-hairline">
          {rows.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              busy={busyId === p.id}
              onAdd={(person) =>
                run(person, () => sync.addFriend(person.id), (outcome, who) =>
                  outcome === 'friends'
                    ? `You and ${personLabel(who)} are friends.`
                    : `Asked ${personLabel(who)}. They will see it next time they open the app.`,
                )
              }
              onRemove={(person) => run(person, () => sync.removeFriend(person.id))}
            />
          ))}
        </ul>
      </>
    ) : null

  return (
    <section>
      <h2 className="eyebrow mb-2 px-1">People</h2>
      <Card className="px-4 py-4">
        {error && (
          <div className="mb-3">
            <Alert tone="quiet" icon={ICONS.warning}>
              {error}
            </Alert>
          </div>
        )}
        {sync.peopleError && (
          <div className="mb-3">
            <Alert tone="quiet" icon={ICONS.warning}>
              {sync.peopleError}
            </Alert>
          </div>
        )}
        {notice && (
          <div className="mb-3" role="status">
            <Alert icon={ICONS.check}>{notice}</Alert>
          </div>
        )}

        {loading ? (
          <p className="flex items-center gap-2.5 py-3 text-sm text-ink-2" aria-busy="true">
            <Spinner size={16} />
            Looking for the others…
          </p>
        ) : people.length === 0 ? (
          // Only claim the place is empty when the server actually said so. A
          // failed lookup returns an empty list too, and "nobody else has an
          // account yet" printed directly under "run this migration" is the
          // app contradicting itself about the one thing this panel is for.
          <p className="py-2 text-sm leading-relaxed text-ink-2">
            {sync.peopleError
              ? 'Until then, nobody can be listed here.'
              : 'Nobody else has an account yet. When somebody signs up they appear here, and either of you can add the other.'}
          </p>
        ) : (
          <>
            <Section title="Waiting on you" rows={incoming} />
            <Section title="Friends" rows={friends} />
            <Section title={friends.length || incoming.length ? 'Everyone else' : 'Here'} rows={rest} />
          </>
        )}
      </Card>

      <p className="mt-2 px-1 text-xs leading-relaxed text-ink-2">
        Adding somebody lets the two of you see each other — name, photo, whether they are about, and
        how far through they have got. It does not join your reading: your passages, your notes and
        your one spin a day are still your own.
      </p>
    </section>
  )
}
