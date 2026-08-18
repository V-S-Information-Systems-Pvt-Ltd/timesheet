// lib/shortcuts.ts
// Shared keyboard-shortcut utilities: guard logic and focus helpers.
// Pure enough to unit-test (operates on Element | null, no DOM globals).

/** True when `el` is a text-input control where typing should not trigger shortcuts. */
export function isFormField(el: Element | null): boolean {
  if (!el) return false
  if (el.tagName.toLowerCase() === 'input') {
    const type = (el as HTMLInputElement).type
    return type === 'text' ||
      type === 'email' ||
      type === 'password' ||
      type === 'number' ||
      type === 'search' ||
      type === 'tel' ||
      type === 'url' ||
      type === 'date' ||
      type === 'time' ||
      type === 'datetime-local' ||
      type === ''
  }
  if (el.tagName.toLowerCase() === 'textarea') return true
  return el.getAttribute('contenteditable') === 'true'
}

/**
 * Focus the first element matching `selector`, scrolling it into view first.
 * Returns true on success, false when the element was not found.
 */
export function focusBySelector(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) return false
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  el.focus()
  return true
}
