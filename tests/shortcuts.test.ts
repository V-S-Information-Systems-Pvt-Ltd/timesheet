// tests/shortcuts.test.ts
// Tests for the keyboard-shortcut guard: verifies it correctly identifies
// form fields where typing should block shortcut activation.
import { describe, expect, it } from 'vitest'
import { isFormField } from '../lib/shortcuts'

function mockEl(tagName: string, attrs: Record<string, string | null> = {}): Element {
  return {
    tagName,
    getAttribute: (name: string) => attrs[name] ?? null,
  } as unknown as Element
}

function mockInput(type: string): Element {
  return {
    tagName: 'INPUT',
    type,
  } as unknown as HTMLInputElement & Element
}

describe('isFormField', () => {
  it('returns false for null', () => {
    expect(isFormField(null)).toBe(false)
  })

  it('returns true for text inputs', () => {
    expect(isFormField(mockInput('text'))).toBe(true)
  })

  it('returns true for textarea', () => {
    expect(isFormField(mockEl('TEXTAREA'))).toBe(true)
  })

  it('returns true for contenteditable elements', () => {
    expect(isFormField(mockEl('DIV', { contenteditable: 'true' }))).toBe(true)
  })

  it('returns false for checkbox inputs', () => {
    expect(isFormField(mockInput('checkbox'))).toBe(false)
  })

  it('returns false for button inputs', () => {
    expect(isFormField(mockInput('button'))).toBe(false)
  })

  it('returns false for a plain div', () => {
    expect(isFormField(mockEl('DIV'))).toBe(false)
  })

  it('returns false for select elements', () => {
    expect(isFormField(mockEl('SELECT'))).toBe(false)
  })
})
