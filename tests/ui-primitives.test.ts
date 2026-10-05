import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Input, Select, Td, Th, Checkbox, FileField, DataTable, Menu, AsyncSection, type DataColumn } from '@/app/components/ui'

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

  it('Td carries its column label for stacked mobile tables, and omits it when unset', () => {
    expect(renderToStaticMarkup(createElement(Td, { label: 'Name' }, 'Alpha'))).toContain('data-label="Name"')
    expect(renderToStaticMarkup(createElement(Td, {}, 'Alpha'))).not.toContain('data-label')
  })

  it('uses column header scope and does not compete with explicit alignment', () => {
    const html = renderToStaticMarkup(createElement(Th, { className: 'text-right' }, 'Hours'))
    expect(html).toContain('scope="col"')
    expect(classes(html)).toContain('text-right')
    expect(classes(html)).not.toContain('text-left')
  })

  it('honors emphasized cell text without a competing muted class', () => {
    const actual = classes(renderToStaticMarkup(createElement(Td, { className: 'text-right text-fg' }, '8')))
    expect(actual).toContain('text-fg')
    expect(actual).not.toContain('text-fg-muted')
  })

  it('retains muted cell text when only alignment changes', () => {
    expect(classes(renderToStaticMarkup(createElement(Td, { className: 'text-right' }, '8')))).toContain('text-fg-muted')
  })
})

describe('new primitives (P0)', () => {
  it('Checkbox renders a checkbox input with the house accent', () => {
    const html = renderToStaticMarkup(createElement(Checkbox))
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('accent-primary-600')
  })

  it('Checkbox with a label wraps the box in a tap-target label row', () => {
    const html = renderToStaticMarkup(createElement(Checkbox, { label: 'Remember me' }))
    expect(html).toContain('<label')
    expect(html).toContain('Remember me')
    expect(html).toContain('type="checkbox"')
  })

  it('FileField gives its file input an accessible name', () => {
    const html = renderToStaticMarkup(createElement(FileField, { label: 'Import CSV', onFiles: () => {} }))
    expect(html).toContain('type="file"')
    expect(html).toContain('aria-label="Import CSV"')
    expect(html).toContain('Import CSV')
  })

  it('DataTable renders headers and cells, and the empty node when there are no rows', () => {
    type Row = { name: string }
    const RowTable = DataTable as ComponentType<{
      columns: DataColumn<Row>[]
      rows: Row[]
      rowKey: (row: Row, index: number) => string
      empty?: ReactNode
    }>
    const columns: DataColumn<Row>[] = [{ key: 'name', header: 'Name', cell: (r) => r.name }]
    const filled = renderToStaticMarkup(
      createElement(RowTable, { columns, rows: [{ name: 'Alpha' }], rowKey: (r) => r.name })
    )
    expect(filled).toContain('Name')
    expect(filled).toContain('Alpha')
    const emptyHtml = renderToStaticMarkup(
      createElement(RowTable, { columns, rows: [], rowKey: (r) => r.name, empty: 'Nothing here' })
    )
    expect(emptyHtml).toContain('Nothing here')
  })

  it('Menu renders a collapsed trigger and no open menu until interaction', () => {
    const html = renderToStaticMarkup(
      createElement(Menu, { label: 'Row actions', trigger: '⋯', items: [{ label: 'Edit', onSelect: () => {} }] })
    )
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('role="menu"')
  })

  it('AsyncSection shows a skeleton while loading, an alert with Retry on error, and children when ready', () => {
    const Section = AsyncSection as ComponentType<{ loading: boolean; error: string | null; reload: () => void }>
    const ready = renderToStaticMarkup(
      createElement(Section, { loading: false, error: null, reload: () => {} }, 'Loaded content')
    )
    expect(ready).toContain('Loaded content')

    const loading = renderToStaticMarkup(
      createElement(Section, { loading: true, error: null, reload: () => {} }, 'Loaded content')
    )
    expect(loading).toContain('animate-pulse')
    expect(loading).not.toContain('Loaded content')

    const failed = renderToStaticMarkup(
      createElement(Section, { loading: false, error: 'Network down', reload: () => {} }, 'Loaded content')
    )
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('Could not load: Network down')
    expect(failed).toContain('Retry')
    expect(failed).not.toContain('Loaded content')
  })
})
