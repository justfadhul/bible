/**
 * Appearance: Light, Dark, or follow the system.
 *
 * Kept in its own localStorage key rather than in the reading-history schema.
 * Appearance is a property of this device, not of the shared reading log — so
 * exporting your history and importing it on a phone should not drag a
 * laptop's theme along with it.
 */

export const THEME_KEY = 'spin-catalog:theme'
export const THEMES = ['system', 'light', 'dark']

export function getTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return THEMES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

export function saveTheme(theme) {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, theme)
    return true
  } catch {
    return false
  }
}

/** The theme actually showing right now, resolving 'system' against the OS. */
export function resolvedTheme(theme) {
  if (theme !== 'system') return theme
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/**
 * Stamps the choice on <html>.
 *
 * 'system' removes the attribute entirely rather than writing the resolved
 * value, so the CSS media query stays in charge and the page follows the OS
 * live — including when it changes while the app is open.
 */
export function applyTheme(theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme === 'system' ? 'light dark' : theme
}
