import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Input, Select, Td } from '@/app/components/ui'

function classes(html: string): string[] {
  return html.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? []
}

const controls: { label: string; component: ComponentType<{ className?: string }> }[] = [
  { label: 'Input', component: Input },
  { label: 'Select', component: Select },
]

describe('primitive class overrides', () => {
  for (const { label, component: Control } of controls) {
    it(`${label} keeps full width by default`, () => {
      expect(classes(renderToStaticMarkup(createElement(Control)))).toContain('w-full')
    })

    it(`${label} omits the full-width default when a compact width is requested`, () => {
      const actual = classes(renderToStaticMarkup(createElement(Control, { className: 'w-auto' })))
      expect(actual).toContain('w-auto')
      expect(actual).not.toContain('w-full')
    })

    it(`${label} keeps the base width with only a responsive override`, () => {
      const actual = classes(renderToStaticMarkup(createElement(Control, { className: 'sm:w-auto' })))
      expect(actual).toContain('w-full')
      expect(actual).toContain('sm:w-auto')
    })
  }

  it('honors emphasized cell text without a competing muted class', () => {
    const actual = classes(renderToStaticMarkup(createElement(Td, { className: 'text-right text-fg' }, '8')))
    expect(actual).toContain('text-fg')
    expect(actual).not.toContain('text-fg-muted')
  })

  it('retains muted cell text when only alignment changes', () => {
    expect(classes(renderToStaticMarkup(createElement(Td, { className: 'text-right' }, '8')))).toContain('text-fg-muted')
  })
})
