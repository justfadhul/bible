/**
 * Managing who is reading.
 *
 * A reader has a name and a picture. Both are optional — the app works with
 * neither — but a name you chose and a face you recognise are what turn a
 * checkbox from bookkeeping into "did Sam actually read this".
 */
import { useRef, useState } from 'react'
import { Alert, Avatar, Button, Card, Field, Icon, ICONS, Spinner } from './ui.jsx'
import { displayName, nameFromEmail, NAME_SUGGESTIONS } from '../lib/readers.js'
import { fileToAvatarDataUrl, dataUrlToBlob } from '../lib/image.js'
import { MAX_READERS } from '../lib/storage.js'
import * as haptics from '../lib/haptics.js'

function ReaderRow({ reader, index, isYou, canRemove, onUpdate, onRemove, onPhoto, busyPhoto }) {
  const [open, setOpen] = useState(false)
  const fileRef = useRef(null)
  const suggestionsId = `sugg-${reader.id}`

  return (
    <div className="rounded-r3 bg-inset/0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative rounded-full"
          aria-label={`Change ${displayName(reader, index)}'s photo`}
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
            {isYou ? 'You' : reader.userId ? 'Signed in' : 'On this device'}
            {reader.email ? ` · ${reader.email}` : ''}
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
        aria-label={`Choose a photo for ${displayName(reader, index)}`}
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
            placeholder={nameFromEmail(reader.email) || `Reader ${String.fromCharCode(65 + index)}`}
            maxLength={60}
            onChange={(e) => onUpdate(reader.id, { name: e.target.value })}
            hint="Leave it blank to use your email address."
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
            <Button variant="secondary" className="flex-1" onClick={() => fileRef.current?.click()}>
              {reader.avatarUrl ? 'Change photo' : 'Add photo'}
            </Button>
            {reader.avatarUrl && (
              <Button variant="secondary" className="flex-1" onClick={() => onUpdate(reader.id, { avatarUrl: null })}>
                Remove photo
              </Button>
            )}
          </div>

          {canRemove && (
            <Button variant="danger" className="w-full" onClick={() => onRemove(reader)}>
              Remove {displayName(reader, index)}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export default function Readers({ state, sync, onUpdate, onAdd, onRemove }) {
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const myUserId = sync?.session?.user?.id ?? null

  const handlePhoto = async (reader, file) => {
    setError(null)
    setBusyId(reader.id)
    try {
      // Always downscale first: a camera JPEG is megabytes, and this has to
      // fit in localStorage as well as travel over a phone connection.
      const dataUrl = await fileToAvatarDataUrl(file)
      let url = dataUrl
      // Signed in, and it is your own row: put it somewhere the others can see.
      if (sync?.session && reader.userId && reader.userId === myUserId) {
        try {
          url = await sync.uploadAvatar(dataUrlToBlob(dataUrl), reader.userId)
        } catch (e) {
          // Keep the local copy rather than losing the photo over a bad upload.
          setError(`Saved on this device, but the upload failed: ${e.message}`)
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

  return (
    <section>
      <h2 className="eyebrow mb-2 px-1">Readers</h2>
      <Card className="space-y-4 px-4 py-4">
        {error && (
          <Alert tone="quiet" icon={ICONS.warning}>
            {error}
          </Alert>
        )}

        {state.readers.map((r, i) => (
          <div key={r.id}>
            {i > 0 && <span aria-hidden="true" className="mb-4 block h-px bg-hairline" />}
            <ReaderRow
              reader={r}
              index={i}
              isYou={!!myUserId && r.userId === myUserId}
              canRemove={state.readers.length > 1}
              busyPhoto={busyId === r.id}
              onUpdate={onUpdate}
              onRemove={setConfirmRemove}
              onPhoto={handlePhoto}
            />
          </div>
        ))}

        {confirmRemove && (
          <div className="space-y-3 rounded-r3 p-3 sunken">
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

        <Button
          variant="secondary"
          className="w-full"
          disabled={state.readers.length >= MAX_READERS}
          onClick={() => {
            haptics.tap()
            onAdd()
          }}
        >
          <Icon path="M12 5.5v13M5.5 12h13" size={18} />
          {state.readers.length >= MAX_READERS ? `Limit is ${MAX_READERS} readers` : 'Add a reader'}
        </Button>
      </Card>
      <p className="mt-2 px-1 text-xs leading-relaxed text-ink-2">
        {sync?.session
          ? 'Signing in fills in your name from your email address; you can change it to anything. Photos you upload are shared with the others in your group.'
          : 'Names and photos stay on this device until you sign in under Sharing.'}
      </p>
    </section>
  )
}
