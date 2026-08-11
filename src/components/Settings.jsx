/**
 * Settings: reader names, export, import, reset.
 *
 * Export writes the persisted state verbatim, so an export → reset → import
 * round trip restores exactly what was there. Import runs the file through the
 * same normalizeState() guard as a localStorage read, so a hand-edited or
 * truncated file cannot corrupt the app.
 */
import { useRef, useState } from 'react'
import { normalizeState } from '../lib/storage.js'
import { TOTAL, meta } from '../lib/catalog.js'

function Panel({ title, children, note }) {
  return (
    <section className="rounded-xl border border-line-soft bg-ground-2 p-4 space-y-3">
      <p className="eyebrow">{title}</p>
      {children}
      {note && <p className="text-2xs text-ink-4 leading-relaxed">{note}</p>}
    </section>
  )
}

export default function Settings({ state, onImport, onReset, onReaderName }) {
  const fileRef = useRef(null)
  const [status, setStatus] = useState(null)
  const [pendingReset, setPendingReset] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `spin-catalog-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus({ kind: 'ok', text: `Exported ${state.completed.length} readings.` })
  }

  const importJSON = async (file) => {
    if (!file) return
    try {
      const text = await file.text()
      const { state: next, problems } = normalizeState(JSON.parse(text))
      onImport(next)
      setStatus({
        kind: problems.length ? 'warn' : 'ok',
        text: problems.length
          ? `Imported ${next.completed.length} readings, with ${problems.length} problem(s): ${problems.slice(0, 3).join('; ')}`
          : `Imported ${next.completed.length} readings.`,
      })
    } catch (err) {
      setStatus({ kind: 'error', text: `Could not read that file: ${err.message}` })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const doReset = () => {
    if (confirmText !== 'RESET') return
    onReset()
    setPendingReset(false)
    setConfirmText('')
    setStatus({ kind: 'ok', text: 'Everything cleared. All 286 passages are back in the pool.' })
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl text-ink">Settings</h1>
        <p className="text-sm text-ink-3">
          {state.completed.length} of {TOTAL} read · catalog v{meta.version}
        </p>
      </header>

      {status && (
        <p
          role="status"
          className={`rounded-lg border p-3 text-sm leading-relaxed ${
            status.kind === 'error'
              ? 'border-red-900/60 bg-red-950/30 text-red-200'
              : status.kind === 'warn'
                ? 'border-amber-900/60 bg-amber-950/30 text-amber-200'
                : 'border-line bg-surface text-ink-2'
          }`}
        >
          {status.text}
        </p>
      )}

      <Panel title="Who is reading" note="Only used to label the two checkboxes on a reading.">
        <div className="space-y-2">
          {['a', 'b'].map((key) => (
            <label key={key} className="flex items-center gap-3">
              <span className="text-2xs text-ink-3 w-16 shrink-0">Reader {key.toUpperCase()}</span>
              <input
                type="text"
                value={state.readerNames[key]}
                onChange={(e) => onReaderName(key, e.target.value.slice(0, 40))}
                maxLength={40}
                className="flex-1 min-w-0 min-h-11 rounded-lg border border-line-soft bg-ground px-3 text-sm text-ink focus:border-line"
              />
            </label>
          ))}
        </div>
      </Panel>

      <Panel
        title="Backup"
        note="Export writes your history to a file. Import replaces everything currently stored, so export first if you might want it back."
      >
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportJSON}
            className="flex-1 min-h-12 rounded-lg border border-line text-sm text-ink hover:bg-surface transition-colors"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex-1 min-h-12 rounded-lg border border-line text-sm text-ink hover:bg-surface transition-colors"
          >
            Import JSON
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={(e) => importJSON(e.target.files?.[0])}
          className="sr-only-live"
          tabIndex={-1}
        />
      </Panel>

      <Panel
        title="Reset"
        note="This clears every reading, every note and the day lock. It cannot be undone."
      >
        {!pendingReset ? (
          <button
            type="button"
            onClick={() => setPendingReset(true)}
            className="w-full min-h-12 rounded-lg border border-red-900/70 text-sm text-red-300 hover:bg-red-950/30 transition-colors"
          >
            Reset everything
          </button>
        ) : (
          <div className="space-y-3">
            <label htmlFor="reset-confirm" className="block text-sm text-ink-2">
              Type <span className="font-semibold text-ink">RESET</span> to confirm.
            </label>
            <input
              id="reset-confirm"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              className="w-full min-h-11 rounded-lg border border-line-soft bg-ground px-3 text-sm text-ink focus:border-line"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingReset(false)
                  setConfirmText('')
                }}
                className="flex-1 min-h-12 rounded-lg border border-line text-sm text-ink hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doReset}
                disabled={confirmText !== 'RESET'}
                className="flex-1 min-h-12 rounded-lg border border-red-900/70 text-sm text-red-300
                           hover:bg-red-950/30 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        )}
      </Panel>

      <p className="text-2xs text-ink-4 leading-relaxed">
        History is stored in this browser only. Nothing is sent anywhere, and clearing site data will remove
        it — export a copy if it matters to you.
      </p>
    </div>
  )
}
