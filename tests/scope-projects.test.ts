import { describe, expect, it } from 'vitest'
import { scopeProjects } from '@vsis/core'

describe('scopeProjects', () => {
  const projects = [
    { id: 'open' },
    { id: 'eng', departments: ['Eng'] },
    { id: 'hidden', is_hidden: true },
  ]

  it('hides department-limited projects from other or missing departments', () => {
    expect(scopeProjects(projects, 'Sales').map(p => !!p.is_hidden)).toEqual([false, true, true])
    expect(scopeProjects(projects, null).map(p => !!p.is_hidden)).toEqual([false, true, true])
  })

  it('leaves a member department and already-hidden projects as they are', () => {
    expect(scopeProjects(projects, 'Eng').map(p => !!p.is_hidden)).toEqual([false, false, true])
  })
})
