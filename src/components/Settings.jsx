/**
 * Settings.
 *
 * Export writes the persisted state verbatim, so an export → reset → import
 * round trip restores exactly what was there. Import runs the file through the
 * same normalizeState() guard as a localStorage read, so a hand-edited or
 * truncated file cannot corrupt the app.
 */
import { useRef, useState } from 'react'
import { Alert, Button, Card, Field, Icon, ICONS, Segmented } from './ui.jsx'
import Readers from './Readers.jsx'
import Sharing from './Sharing.jsx'
import { normalizeState } from '../lib/storage.js'
import { TOTAL, meta } from '../lib/catalog.js'
import { APP_NAME } from '../lib/brand.js'

function Group({ header, footer, children, className = '' }) {
  return (
    <section>
      {header && <h2 className="eyebrow mb-2 px-1">{header}</h2>}
      <Card className={`px-4 py-4 ${className}`}>{children}</Card>
      {footer && <p className="mt-2 px-1 text-xs leading-relaxed text-ink-2">{footer}</p>}
    </section>
  )
}

/**
 * Vibration.
 *
 * This group is always shown, including on a device that cannot vibrate at
 * all. Hiding it there was the wrong instinct: someone who has just spun the
 * wheel and felt nothing goes looking for the setting, and finding no setting
 * tells them the app is broken rather than that their browser has no such
 * ability. So the control is replaced by the reason, and there is a Test
 * button so nobody has to burn their one spin a day finding out.
 */
function Haptics({ hx }) {
  const [result, setResult] = useState(null)
  if (!hx) return null

  const FOOTERS = {
    vibrate:
      'Short buzzes as the wheel ticks past each segment, and one firmer note when it stops. Silent mode and Do Not Disturb can still suppress them.',
    switch:
      'iOS has no vibration API, so this borrows the tap Safari plays when a switch flips. It is a single tap rather than a buzz, and it needs iOS 17.4 or later with System Haptics on in Settings → Sounds & Haptics.',
    none: 'Vibration is an Android and iPhone ability. On a desktop browser there is nothing to buzz.',
  }

  const runTest = () => {
    const { fired } = hx.test()
    setResult(
      fired
        ? 'Sent. If you felt nothing, check that your phone is not on silent and that system haptics are on.'
        : 'This browser turned it down — nothing was sent.',
    )
  }

  return (
    <Group header="Feedback" footer={FOOTERS[hx.mode]}>
      {hx.mode === 'none' ? (
        <p className="text-sm text-ink-2">This browser has no way to vibrate.</p>
      ) : (
        <div className="space-y-3">
          <Segmented
            label="Vibration"
            value={hx.enabled ? 'on' : 'off'}
            onChange={(v) => {
              setResult(null)
              hx.set(v === 'on')
            }}
            options={[
              { value: 'on', label: 'Vibration on' },
              { value: 'off', label: 'Off' },
            ]}
          />
          <Button variant="secondary" className="w-full" onClick={runTest}>
            Test it now
          </Button>
          {result && (
            <p className="px-1 text-xs leading-relaxed text-ink-2" role="status">
              {result}
            </p>
          )}
        </div>
      )}
    </Group>
  )
}

export default function Settings({ state, sync, theme, onTheme, onImport, onReset, onUpdateReader, onAddReader, onRemoveReader, haptics: hx }) {
  const fileRef = useRef(null)
  const [status, setStatus] = useState(null)
  const [pendingReset, setPendingReset] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `${APP_NAME.toLowerCase()}-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus({ kind: 'ok', text: `Exported ${state.completed.length} readings.` })
  }

  const importJSON = async (file) => {
    if (!file) return
    setImporting(true)
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
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const doReset = () => {
    if (confirmText !== 'RESET') return
    onReset()
    setPendingReset(false)
    setConfirmText('')
    setStatus({ kind: 'ok', text: `Everything cleared. All ${TOTAL} passages are back in the pool.` })
  }

  return (
    <div className="space-y-6">
      {status && (
        <div role="status">
          <Alert
            tone={status.kind === 'ok' ? 'accent' : 'quiet'}
            icon={status.kind === 'ok' ? ICONS.check : ICONS.warning}
          >
            {status.text}
          </Alert>
        </div>
      )}

      {sync && <Sharing sync={sync} />}

      <Group header="Appearance" footer="System follows your device's Light or Dark setting, and changes with it.">
        <Segmented
          label="Appearance"
          value={theme}
          onChange={onTheme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
      </Group>

      <Haptics hx={hx} />

      <Readers
        state={state}
        sync={sync}
        onUpdate={onUpdateReader}
        onAdd={onAddReader}
        onRemove={onRemoveReader}
      />

      <Group
        header="Backup"
        footer="Export writes your history to a file. Import replaces everything currently stored, so export first if you might want it back."
        className="flex gap-2.5"
      >
        <Button variant="secondary" className="flex-1" disabled={importing} onClick={exportJSON}>
          Export JSON
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          disabled={importing}
          busy={importing}
          onClick={() => fileRef.current?.click()}
        >
          {importing ? 'Reading' : 'Import JSON'}
        </Button>
        {/* Driven by the Import button above; hidden rather than styled. */}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label={`Choose a ${APP_NAME} export file to import`}
          onChange={(e) => importJSON(e.target.files?.[0])}
          className="sr-only-live"
          tabIndex={-1}
        />
      </Group>

      <Group header="Reset" footer="This clears every reading, every note and the day lock. It cannot be undone.">
        {!pendingReset ? (
          <Button variant="danger" className="w-full" onClick={() => setPendingReset(true)}>
            Reset everything
          </Button>
        ) : (
          <div className="space-y-3.5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-r3 text-warn sunken">
                <Icon path={ICONS.warning} size={20} />
              </span>
              <p className="flex-1 text-sm leading-relaxed text-ink-2">
                Type <span className="font-semibold text-ink">RESET</span> to confirm. Everything goes.
              </p>
            </div>
            <Field
              id="reset-confirm"
              aria-label="Type RESET to confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="RESET"
            />
            <div className="flex gap-2.5">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setPendingReset(false)
                  setConfirmText('')
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={doReset}
                disabled={confirmText !== 'RESET'}
                style={
                  confirmText === 'RESET'
                    ? { background: 'var(--danger)', color: '#fff', boxShadow: 'var(--e3)' }
                    : undefined
                }
              >
                Reset
              </Button>
            </div>
          </div>
        )}
      </Group>

      <p className="px-1 pb-2 text-xs leading-relaxed text-ink-2">
        {state.completed.length} of {TOTAL} read · catalog v{meta.version}
        <br />
        {sync?.pair
          ? 'History is saved on this device and in your shared Supabase project, so either of you can read it from anywhere.'
          : 'History is stored in this browser only. Nothing is sent anywhere, and clearing site data will remove it — export a copy if it matters to you.'}
      </p>
    </div>
  )
}
