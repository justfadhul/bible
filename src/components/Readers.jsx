/**
 * Who is reading.
 *
 * There is no "add a reader" here, and that absence is the design. A reader is
 * an account: the way a second person appears in this list is that they sign
 * up on their own phone and join the group with the invite code. Typing
 * somebody into existence on your device produced a row nobody could ever sign
 * in as, whose name only you could fix, and whose ticks meant "I think they
 * read it" rather than "they said they did".
 *
 * So this panel has three kinds of row, each editable by exactly the right
 * person:
 *
 *   you        name and photo, yours to change
 *   the others read-only — each of them edits their own on their own phone
 *   leftovers  readers made on this device before any of this was an account,
 *              kept so their ticks are not lost, removable once they are done
 */
import { useRef, useState } from 'react'
import { Alert, Avatar, Button, Card, Field, Icon, ICONS, Spinner } from './ui.jsx'
import { describeSyncError } from '../hooks/useSync.js'
import { displayName, nameFromEmail, NAME_SUGGESTIONS } from '../lib/readers.js'
import { fileToAvatarDataUrl, dataUrlToBlob } from '../lib/image.js'
import { MAX_READERS } from '../lib/storage.js'
import * as haptics from '../lib/haptics.js'

function YouRow({ reader, index, signedIn, onUpdate, onPhoto, busyPhoto }) {
  const [open, setOpen] = useState(false)
  const fileRef = useRef(null)
  const suggestionsId = `sugg-${reader.id}`

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busyPhoto}
          className="relative rounded-full"
          aria-label={busyPhoto ? 'Uploading your photo' : 'Change your photo'}
        >
          <Avatar reader={reader} index={index} size={48} />
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -bottom-0.5 grid size-5 place-items-center rounded-full bg-accent text-accent-ink"
            style={{ boxShadow: 'var(--e2)' }}
          >
            {busyPhoto ? <Spinner size={12} /> : <Icon path="M12 5.5v13M5.5 12h13" size={12} strokeWidth={2.6} />}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{displayName(reader, index)}</p>
          <p className="truncate text-xs text-ink-2">
            You
            {reader.email ? ` · ${reader.email}` : signedIn ? '' : ' · on this device'}
          </p>
        </div>

        <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Done' : 'Edit'}
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only-live"
        tabIndex={-1}
        aria-label="Choose your photo"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onPhoto(reader, f)
        }}
      />

      {open && (
        <div className="mt-3.5 space-y-3">
          <Field
            id={`name-${reader.id}`}
            label="Name"
            value={reader.name}
            placeholder={nameFromEmail(reader.email) || 'Your name'}
            maxLength={60}
            onChange={(e) => onUpdate(reader.id, { name: e.target.value })}
            hint={
              signedIn
                ? 'This is the name the others see. Leave it blank to use your email address.'
                : 'Only on this device until you create an account.'
            }
          />

          <div>
            <p id={suggestionsId} className="eyebrow mb-2">
              Or borrow a name
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={suggestionsId}>
              {NAME_SUGGESTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    haptics.tap()
                    onUpdate(reader.id, { name: n })
                  }}
                  aria-pressed={reader.name === n}
                  className={`raised-2 min-h-10 rounded-r5 px-3 text-sm ${
                    reader.name === n ? 'font-semibold text-accent' : 'text-ink-2'
                  }`}
                  style={reader.name === n ? { boxShadow: 'var(--inset)' } : undefined}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2.5">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={busyPhoto}
              busy={busyPhoto}
              onClick={() => fileRef.current?.click()}
            >
              {busyPhoto ? 'Uploading' : reader.avatarUrl ? 'Change photo' : 'Add photo'}
            </Button>
            {reader.avatarUrl && (
              <Button
                variant="secondary"
                className="flex-1"
                disabled={busyPhoto}
                onClick={() => onUpdate(reader.id, { avatarUrl: null })}
              >
                Remove photo
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Somebody else's account: their name and face, and nothing you can change. */
function TheirRow({ reader, index }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar reader={reader} index={index} size={48} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{displayName(reader, index)}</p>
        <p className="truncate text-xs text-ink-2">{reader.email ?? 'Signed in'}</p>
      </div>
    </div>
  )
}

/** A reader from before readers were accounts: kept for their ticks, not forever. */
function LeftoverRow({ reader, index, onRemove }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar reader={reader} index={index} size={48} className="opacity-70" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink-2">{displayName(reader, index)}</p>
        <p className="truncate text-xs text-ink-2">No account · only on this device</p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => onRemove(reader)}>
        Remove
      </Button>
    </div>
  )
}

export default function Readers({ state, sync, onUpdate, onRemove }) {
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const myUserId = sync?.session?.user?.id ?? null
  const signedIn = Boolean(myUserId)

  const isYou = (r) => (myUserId ? r.userId === myUserId : !r.userId)
  const you = state.readers.find(isYou) ?? state.readers[0]
  const others = state.readers.filter((r) => r !== you)

  // Someone can be in the group without being in this list yet: they join, and
  // their reader arrives the first time their phone syncs. Saying so beats a
  // roster that quietly disagrees with the member count.
  const pending = Math.max(
    0,
    (sync?.pair?.member_count ?? 0) - state.readers.filter((r) => r.userId).length,
  )

  const handlePhoto = async (reader, file) => {
    setError(null)
    setBusyId(reader.id)
    try {
      // Always downscale first: a camera JPEG is megabytes, and this has to fit
      // in localStorage as well as travel over a phone connection.
      const dataUrl = await fileToAvatarDataUrl(file)
      let url = dataUrl
      // Signed in: put it somewhere the others can see it.
      if (sync?.session && reader.userId && reader.userId === myUserId) {
        try {
          url = await sync.uploadAvatar(dataUrlToBlob(dataUrl), reader.userId)
        } catch (e) {
          // Keep the local copy rather than losing the photo over a bad upload.
          // It stays a data: URL, which is what the retry in App.jsx looks for,
          // so this is a delay rather than something the reader must redo.
          setError(`${describeSyncError(e)} Your photo is saved on this phone and will upload by itself.`)
        }
      }
      onUpdate(reader.id, { avatarUrl: url })
      haptics.toggle()
    } catch (e) {
      haptics.error()
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const divider = <span aria-hidden="true" className="my-4 block h-px bg-hairline" />

  return (
    <section>
      <h2 className="eyebrow mb-2 px-1">Readers</h2>
      <Card className="px-4 py-4">
        {error && (
          <div className="mb-4">
            <Alert tone="quiet" icon={ICONS.warning}>
              {error}
            </Alert>
          </div>
        )}

        <YouRow
          reader={you}
          index={state.readers.indexOf(you)}
          signedIn={signedIn}
          busyPhoto={busyId === you.id}
          onUpdate={onUpdate}
          onPhoto={handlePhoto}
        />

        {others.map((r) => (
          <div key={r.id}>
            {divider}
            {r.userId ? (
              <TheirRow reader={r} index={state.readers.indexOf(r)} />
            ) : (
              <LeftoverRow reader={r} index={state.readers.indexOf(r)} onRemove={setConfirmRemove} />
            )}
          </div>
        ))}

        {pending > 0 && (
          <>
            {divider}
            <p className="text-sm leading-relaxed text-ink-2">
              {pending === 1
                ? 'One more person has joined the group but has not opened the app yet.'
                : `${pending} more people have joined the group but have not opened the app yet.`}{' '}
              They appear here on their first sync.
            </p>
          </>
        )}

        {confirmRemove && (
          <div className="mt-4 space-y-3 rounded-r3 p-3 sunken">
            <p className="text-sm leading-relaxed text-ink-2">
              Remove <span className="font-semibold text-ink">{displayName(confirmRemove)}</span>? Their
              ticks come off every reading. The readings themselves stay.
            </p>
            <div className="flex gap-2.5">
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmRemove(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                style={{ background: 'var(--danger)', color: '#fff', boxShadow: 'var(--e3)' }}
                onClick={() => {
                  onRemove(confirmRemove.id)
                  setConfirmRemove(null)
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        )}
      </Card>

      <p className="mt-2 px-1 text-xs leading-relaxed text-ink-2">
        {!signedIn
          ? 'Create an account above and this row becomes yours.'
          : state.readers.filter((r) => r.userId).length < 2
            ? `This is who reads from this history. Adding someone under People lets you see each other — it does not yet join your reading, so for now this list is just you. Up to ${MAX_READERS} can share a history.`
            : 'Everyone here signed up for themselves. Each of you edits your own name and photo; nobody can edit anybody else’s.'}
      </p>
    </section>
  )
}
