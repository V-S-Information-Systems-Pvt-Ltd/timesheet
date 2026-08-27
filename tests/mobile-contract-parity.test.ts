import { describe, expect, it } from 'vitest'
import {
  mapActorDto,
  mapTimesheetDto,
  mapReferenceDto,
  type ReportTotalsDto,
} from '@/lib/api/v1/contracts'
import type { Actor } from '@/lib/db/repository'
import type { Timesheet, Project, ActivityType } from '@/app/types'

describe('v1 Mobile Contract Parity', () => {
  it('maps actor roles to capabilities according to two-axis role rules', () => {
    const adminActor: Actor = {
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
      permission_role: 'admin',
      hierarchy_role: 'user',
      isActive: true,
    }
    const adminDto = mapActorDto(adminActor)
    expect(adminDto.capabilities).toEqual({
      canViewTeam: true,
      canManageProjects: true,
      canManageActivities: true,
      canManageUsers: true,
      canManageSettings: true,
    })

    const pmActor: Actor = {
      id: 'pm-1',
      email: 'pm@example.com',
      role: 'pm',
      permission_role: 'pm',
      hierarchy_role: 'user',
      isActive: true,
    }
    const pmDto = mapActorDto(pmActor)
    expect(pmDto.capabilities).toEqual({
      canViewTeam: false,
      canManageProjects: true,
      canManageActivities: false,
      canManageUsers: false,
      canManageSettings: false,
    })

    const managerActor: Actor = {
      id: 'mgr-1',
      email: 'mgr@example.com',
      role: 'manager',
      permission_role: 'user',
      hierarchy_role: 'manager',
      isActive: true,
    }
    const mgrDto = mapActorDto(managerActor)
    expect(mgrDto.capabilities).toEqual({
      canViewTeam: true,
      canManageProjects: false,
      canManageActivities: false,
      canManageUsers: false,
      canManageSettings: false,
    })

    const standardUserActor: Actor = {
      id: 'user-1',
      email: 'user@example.com',
      role: 'user',
      permission_role: 'user',
      hierarchy_role: 'user',
      isActive: true,
    }
    const userDto = mapActorDto(standardUserActor)
    expect(userDto.capabilities).toEqual({
      canViewTeam: false,
      canManageProjects: false,
      canManageActivities: false,
      canManageUsers: false,
      canManageSettings: false,
    })
  })

  it('maps Timesheet database rows to flat wire DTOs without phantom fields', () => {
    const dbRow: Timesheet = {
      id: 'ts-101',
      user_id: 'user-1',
      project_id: 'proj-5',
      activity_type_id: 'act-2',
      log_date: '2026-08-27',
      hours_worked: 7.5,
      work_done: 'Implemented v1 wire DTO contract alignment',
      created_at: '2026-08-27T10:00:00.000Z',
      projects: { name: 'Timesheet Mobile' },
      activity_types: { name: 'Engineering' },
      profiles: { email: 'developer@vsis.com' },
    }

    const dto = mapTimesheetDto(dbRow)
    expect(dto).toEqual({
      id: 'ts-101',
      user_id: 'user-1',
      user_email: 'developer@vsis.com',
      project_id: 'proj-5',
      project_name: 'Timesheet Mobile',
      activity_type_id: 'act-2',
      activity_name: 'Engineering',
      log_date: '2026-08-27',
      hours_worked: 7.5,
      work_done: 'Implemented v1 wire DTO contract alignment',
      created_at: '2026-08-27T10:00:00.000Z',
    })

    // Verify absence of unsupported legacy/phantom fields
    expect(dto).not.toHaveProperty('notes')
    expect(dto).not.toHaveProperty('status')
  })

  it('maps Project and ActivityType domain objects to reference DTOs', () => {
    const projects: Project[] = [
      { id: 'p1', name: 'Alpha', so_number: 'SO-1234', telegram_no: 42, created_at: '2026-01-01' },
      { id: 'p2', name: 'Beta', so_number: null, telegram_no: null, created_at: '2026-01-01' },
    ]
    const activityTypes: ActivityType[] = [
      { id: 'a1', name: 'Development', is_active: true, telegram_no: 101, created_at: '2026-01-01' },
      { id: 'a2', name: 'Meetings', is_active: false, telegram_no: null, created_at: '2026-01-01' },
    ]

    const ref = mapReferenceDto(projects, activityTypes)
    expect(ref.projects).toEqual([
      { id: 'p1', name: 'Alpha', so_number: 'SO-1234', telegram_no: 42 },
      { id: 'p2', name: 'Beta', so_number: null, telegram_no: null },
    ])
    expect(ref.activityTypes).toEqual([
      { id: 'a1', name: 'Development', is_active: true, telegram_no: 101 },
      { id: 'a2', name: 'Meetings', is_active: false, telegram_no: null },
    ])
  })

  it('validates report summary wire contract structure with label', () => {
    const reportTotals: ReportTotalsDto = {
      totalHours: 42.5,
      totalEntries: 6,
      byGroup: [
        { label: 'Project Alpha', hours: 35, entries: 5 },
        { label: 'Project Beta', hours: 7.5, entries: 1 },
      ],
    }

    expect(reportTotals.totalHours).toBe(42.5)
    expect(reportTotals.totalEntries).toBe(6)
    expect(reportTotals.byGroup[0]).toHaveProperty('label')
    expect(reportTotals.byGroup[0]).not.toHaveProperty('key')
    expect(reportTotals.byGroup[0]).not.toHaveProperty('name')
  })
})
