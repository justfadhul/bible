import { useEffect, useState } from 'react'
import { displayName, initials, readerColor } from '../lib/readers.js'

/**
 * The design system, as components.
 *
 * Everything here follows the same two rules: depth states what a thing is
 * (raised = pressable, inset = a container or a track), and the teal accent is
 * spent on exactly one element per screen. Nothing invents a colour — the
 * tokens in index.css are the whole palette.
 */

/* ── Iconography: 16 / 20 / 24, 2px stroke ─────────────────────────────── */

export function Icon({ path, size = 20, className = '', strokeWidth = 2, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children ?? <path d={path} />}
    </svg>
  )
}

export const ICONS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM16 16l4.5 4.5',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.9-1.4a1.7 1.7 0 0 0 .34 1.87l.06.06a2.05 2.05 0 1 1-2.9 2.9l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56v.17a2.05 2.05 0 1 1-4.1 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2.05 2.05 0 1 1-2.9-2.9l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3.1a2.05 2.05 0 1 1 0-4.1h.09A1.7 1.7 0 0 0 4.75 9.4a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2.05 2.05 0 1 1 2.9-2.9l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10.29 3.4V3.1a2.05 2.05 0 1 1 4.1 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2.05 2.05 0 1 1 2.9 2.9l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03h.17a2.05 2.05 0 1 1 0 4.1h-.09a1.7 1.7 0 0 0-1.56 1.03Z',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2.2v2.1M12 19.7v2.1M21.8 12h-2.1M4.3 12H2.2M18.93 5.07l-1.48 1.48M6.55 17.45l-1.48 1.48M18.93 18.93l-1.48-1.48M6.55 6.55 5.07 5.07',
  moon: 'M20.5 14.3A8.8 8.8 0 0 1 9.7 3.5a8.8 8.8 0 1 0 10.8 10.8Z',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  undo: 'M4 9h11a5 5 0 0 1 0 10H8M4 9l4-4M4 9l4 4',
  copy: 'M9 9h10v12H9zM5 15V3h10v2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 7.6v.6',
  warning: 'M12 4 2.8 20h18.4L12 4ZM12 10v4.4M12 17.2v.4',
  chevron: 'M8.5 5 15.5 12l-7 7',
  empty: 'M4 5h16v14H4zM8 9h8M8 13h5M17.5 17.5 21 21',
}

/** The wheel as a mark: six segments and a pointer, drawn from the ink tokens. */
export function Brandmark({ className = 'size-16' }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <g transform="translate(32 34)">
        <circle r="21.5" fill="none" stroke="var(--hairline-strong)" strokeWidth="1.5" />
        <path d="M0 -19 A19 19 0 0 1 16.5 9.5 L0 0 Z" fill="var(--accent)" />
        <path d="M16.5 9.5 A19 19 0 0 1 -16.5 9.5 L0 0 Z" fill="var(--ink-3)" />
        <path d="M-16.5 9.5 A19 19 0 0 1 0 -19 L0 0 Z" fill="var(--ink-2)" />
        <circle r="6.5" fill="var(--surface-raised)" stroke="var(--hairline-strong)" strokeWidth="1.2" />
      </g>
      <path d="M32 5.5 L27.5 14 L36.5 14 Z" fill="var(--ink)" />
    </svg>
  )
}

/* ── Buttons ───────────────────────────────────────────────────────────── */

const SIZES = {
  sm: 'min-h-11 px-4 text-sm',
  md: 'min-h-12 px-5 text-[0.9375rem]',
  lg: 'min-h-14 px-6 text-base',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  busy = false,
  ...props
}) {
  const base = `inline-flex items-center justify-center gap-2 rounded-r5 font-semibold
                tracking-[0.01em] disabled:cursor-not-allowed ${SIZES[size]}`

  const styles = {
    // The one accented control on a screen.
    primary: 'text-accent-ink disabled:opacity-100',
    secondary: 'raised text-ink',
    quiet: 'text-accent hover:bg-accent-soft transition-colors',
    danger: 'raised text-danger',
  }

  const primaryStyle =
    variant === 'primary'
      ? {
          background: props.disabled ? 'var(--surface-inset)' : 'var(--accent)',
          color: props.disabled ? 'var(--ink-2)' : 'var(--accent-ink)',
          // Disabled is flat, not inset: inset means a container, and a
          // dead control should not look like somewhere to type.
          boxShadow: props.disabled ? 'none' : 'var(--e3)',
          transition: 'box-shadow .24s var(--ease), transform .24s var(--ease), background-color .24s var(--ease)',
        }
      : undefined

  return (
    <button
      {...props}
      className={`${base} ${styles[variant]} ${variant === 'primary' ? 'active:not-disabled:translate-y-px' : ''} ${className}`}
      style={{ ...primaryStyle, ...props.style }}
      onPointerDown={(e) => {
        if (variant === 'primary' && !props.disabled) e.currentTarget.style.boxShadow = 'var(--inset)'
        props.onPointerDown?.(e)
      }}
      onPointerUp={(e) => {
        if (variant === 'primary' && !props.disabled) e.currentTarget.style.boxShadow = 'var(--e3)'
        props.onPointerUp?.(e)
      }}
      onPointerLeave={(e) => {
        if (variant === 'primary' && !props.disabled) e.currentTarget.style.boxShadow = 'var(--e3)'
        props.onPointerLeave?.(e)
      }}
    >
      {busy && <Spinner size={16} />}
      {children}
    </button>
  )
}

/** The circular tick spinner from the system sheet. */
export function Spinner({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ animation: 'spin-tick 1s steps(8) infinite' }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <rect
          key={i}
          x="11"
          y="2"
          width="2"
          height="5.5"
          rx="1"
          fill="currentColor"
          opacity={0.15 + (i / 8) * 0.85}
          transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  )
}

/**
 * What the shared history is doing, in the header.
 *
 * Only ever shown while it has something to say. A permanent "up to date" is
 * noise on a screen whose job is one passage a day, so success appears for a
 * couple of seconds after a real sync and then gets out of the way; only a
 * problem stays put. Not a button — there is nothing to press, and making it
 * one would put a 44px target in the header for no reason.
 */
export function SyncDot({ status, lastSyncedAt }) {
  const [justSynced, setJustSynced] = useState(false)
  useEffect(() => {
    if (!lastSyncedAt) return
    setJustSynced(true)
    const t = setTimeout(() => setJustSynced(false), 2200)
    return () => clearTimeout(t)
  }, [lastSyncedAt])

  const working = status === 'syncing' || status === 'connecting'
  const failed = status === 'error'
  if (!working && !failed && !justSynced) return null

  return (
    <span
      role="status"
      className="flex items-center gap-1.5 rounded-r5 px-2.5 py-1 text-2xs font-semibold tracking-[0.06em] uppercase"
      style={{
        background: 'var(--surface-inset)',
        boxShadow: 'var(--inset)',
        color: failed ? 'var(--danger)' : 'var(--ink-2)',
      }}
    >
      {working ? (
        <Spinner size={12} />
      ) : (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{ background: failed ? 'var(--danger)' : 'var(--ok)' }}
        />
      )}
      {working ? 'Syncing' : failed ? 'Offline' : 'Saved'}
    </span>
  )
}

/* ── Surfaces ──────────────────────────────────────────────────────────── */

export function Card({ children, className = '', level = 3, as: As = 'section', ...props }) {
  const shadow = { 1: 'var(--e1)', 2: 'var(--e2)', 3: 'var(--e3)', 4: 'var(--e4)', 5: 'var(--e5)' }[level]
  return (
    <As
      {...props}
      className={`rounded-r4 bg-raised ${className}`}
      style={{ boxShadow: shadow, ...props.style }}
    >
      {children}
    </As>
  )
}

export function Inset({ children, className = '', deep = false, as: As = 'div', ...props }) {
  return (
    <As {...props} className={`rounded-r3 ${deep ? 'sunken-deep' : 'sunken'} ${className}`}>
      {children}
    </As>
  )
}

/* ── Tabs: underline, active gets the accent ───────────────────────────── */

export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-hairline">
      {tabs.map(([id, text]) => {
        const active = id === value
        return (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={`relative min-h-11 px-4 text-[0.9375rem] transition-colors
                        ${active ? 'font-semibold text-ink' : 'font-medium text-ink-2 hover:text-ink'}`}
          >
            {text}
            <span
              aria-hidden="true"
              className="absolute inset-x-2 -bottom-px h-[3px] rounded-t-full bg-accent"
              style={{
                transform: `scaleX(${active ? 1 : 0})`,
                opacity: active ? 1 : 0,
                transition: 'transform .34s var(--ease), opacity .2s var(--ease)',
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

/* ── Segmented: inset track, raised thumb ──────────────────────────────── */

export function Segmented({ options, value, onChange, label, className = '' }) {
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`sunken relative isolate grid h-[3.125rem] rounded-r3 p-[3px] ${className}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-[3px] left-[3px] -z-10 rounded-[9px] bg-raised"
        style={{
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translate3d(calc(${index} * 100%), 0, 0)`,
          transition: 'transform .42s var(--ease-spring)',
          boxShadow: 'var(--e2)',
        }}
      />
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`relative z-10 min-w-0 truncate rounded-[9px] px-2 text-sm transition-colors
                        ${on ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* ── Checkbox: filled accent when on, inset well when off ──────────────── */

export function Checkbox({ checked, onChange, label, className = '' }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`group flex min-h-12 items-center gap-3 text-left ${className}`}
    >
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-r2"
        style={{
          background: checked ? 'var(--accent)' : 'var(--surface-inset)',
          boxShadow: checked ? 'var(--e2)' : 'var(--inset), inset 0 0 0 1px var(--hairline-strong)',
          transition: 'background-color .24s var(--ease), box-shadow .24s var(--ease)',
        }}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--accent-ink)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path
            d={ICONS.check}
            pathLength="1"
            strokeDasharray="1"
            style={{ strokeDashoffset: checked ? 0 : 1, transition: 'stroke-dashoffset .32s var(--ease) .04s' }}
          />
        </svg>
      </span>
      <span className={`min-w-0 truncate text-[0.9375rem] ${checked ? 'text-ink' : 'text-ink-2'}`}>{label}</span>
    </button>
  )
}

/* ── Text field: inset well, accent ring on focus, danger ring on error ── */

export function Field({ id, label, hint, error, icon, trailing, className = '', as = 'input', ...props }) {
  const As = as
  const ring = error ? 'var(--danger)' : 'var(--accent)'
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="eyebrow mb-2 block">
          {label}
        </label>
      )}
      <div
        className="sunken relative rounded-r3 transition-[box-shadow]"
        style={error ? { boxShadow: 'var(--inset), 0 0 0 2px var(--danger)' } : undefined}
      >
        {icon && (
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-2">{icon}</span>
        )}
        {/* A slot on the right for a control that belongs to the field itself —
            a reveal toggle, a unit, a clear button. It sits inside the well so
            it reads as part of the input rather than a button beside it. */}
        {trailing && <span className="absolute top-1/2 right-1 -translate-y-1/2">{trailing}</span>}
        <As
          id={id}
          {...props}
          className={`w-full rounded-r3 bg-transparent px-3.5 py-3 text-[0.9375rem] placeholder:text-ink-2
                      focus:outline-none ${icon ? 'pl-10' : ''} ${trailing ? 'pr-13' : ''} ${as === 'textarea' ? 'min-h-28 resize-y' : 'min-h-12'}`}
          onFocus={(e) => {
            e.currentTarget.parentElement.style.boxShadow = `var(--inset), 0 0 0 2px ${ring}`
            props.onFocus?.(e)
          }}
          onBlur={(e) => {
            e.currentTarget.parentElement.style.boxShadow = error ? 'var(--inset), 0 0 0 2px var(--danger)' : ''
            props.onBlur?.(e)
          }}
        />
      </div>
      {(hint || error) && (
        <p className={`mt-1.5 text-xs ${error ? 'text-danger' : 'text-ink-2'}`}>{error || hint}</p>
      )}
    </div>
  )
}

/* ── Badges ────────────────────────────────────────────────────────────── */

export function Badge({ children, tone = 'neutral', style }) {
  const tones = {
    neutral: { background: 'var(--surface-inset)', color: 'var(--ink-2)', boxShadow: 'var(--inset)' },
    accent: { background: 'var(--accent)', color: 'var(--accent-ink)', boxShadow: 'var(--e2)' },
  }
  return (
    <span
      className="inline-flex items-center rounded-r5 px-2.5 py-1 text-2xs font-bold tracking-[0.08em] uppercase"
      style={{ ...tones[tone], ...style }}
    >
      {children}
    </span>
  )
}

/* ── Linear progress: inset track, accent fill ─────────────────────────── */

export function Progress({ value, label }) {
  return (
    <div
      className="sunken h-2.5 w-full overflow-hidden rounded-r5"
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="h-full rounded-r5 bg-accent"
        style={{ width: `${Math.max(value * 100, value > 0 ? 3 : 0)}%`, transition: 'width .6s var(--ease)' }}
      />
    </div>
  )
}

/* ── Alert banner: filled accent, or a quiet inset for lesser notices ──── */

export function Alert({ children, tone = 'accent', icon = ICONS.info }) {
  const filled = tone === 'accent'
  return (
    <div
      className={`flex items-start gap-3 rounded-r3 px-4 py-3 text-sm leading-relaxed ${filled ? '' : 'sunken'}`}
      style={
        filled
          ? { background: 'var(--accent)', color: 'var(--accent-ink)', boxShadow: 'var(--e2)' }
          : { color: 'var(--ink-2)' }
      }
    >
      <Icon path={icon} size={20} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/* ── Avatar ────────────────────────────────────────────────────────────── */

/**
 * A reader's picture, or their initials on a colour derived from their id.
 * The fallback is never a generic silhouette — with several readers the point
 * of the avatar is telling them apart at a glance, and a shared grey outline
 * does the opposite.
 */
export function Avatar({ reader, index = 0, size = 40, ring = false, className = '' }) {
  const name = displayName(reader, index)
  const src = reader?.avatarUrl
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: src ? 'var(--surface-inset)' : readerColor(reader?.id ?? index),
        boxShadow: ring ? 'var(--e2), 0 0 0 2px var(--surface-raised)' : 'var(--e2)',
      }}
      title={name}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <span
          className="font-semibold text-white select-none"
          style={{ fontSize: Math.round(size * 0.36), letterSpacing: '0.02em' }}
          aria-hidden="true"
        >
          {initials(reader, index)}
        </span>
      )}
    </span>
  )
}

/** Overlapping avatars — who has read this, in one glance. */
export function AvatarStack({ readers, size = 26, max = 5 }) {
  const shown = readers.slice(0, max)
  const extra = readers.length - shown.length
  return (
    <span className="inline-flex items-center">
      {shown.map((r, i) => (
        <span key={r.id} style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }}>
          <Avatar reader={r} index={i} size={size} ring />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="grid place-items-center rounded-full bg-inset text-2xs font-semibold text-ink-2"
          style={{ width: size, height: size, marginLeft: -size * 0.3, boxShadow: 'var(--inset)' }}
        >
          +{extra}
        </span>
      )}
    </span>
  )
}

/* ── Empty state: dashed well ──────────────────────────────────────────── */

export function EmptyState({ title, body, action }) {
  return (
    <div className="rounded-r4 border-2 border-dashed border-hairline-strong px-6 py-12 text-center">
      <span className="mx-auto mb-4 grid size-14 place-items-center rounded-r3 text-ink-3 sunken">
        <Icon path={ICONS.empty} size={24} />
      </span>
      <p className="font-serif text-lg font-semibold">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-ink-2">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}
