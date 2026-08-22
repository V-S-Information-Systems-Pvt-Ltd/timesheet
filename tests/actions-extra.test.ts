// tests/actions-extra.test.ts
// Coverage for the remaining app/actions.ts server actions: project/activity
// CRUD, user admin lifecycle, global reminders, backfill window, dashboard
// layout, import, and the super-admin delete flows.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserRole } from '../app/types'

vi.mock('@/lib/auth', () => ({ getActor: vi.fn() }))

vi.mock('@/lib/db', () => ({
  repo: {
    createProject: vi.fn(),
    renameProject: vi.fn(),
    setProjectSO: vi.fn(),
    setProjectTelegramNo: vi.fn(),
    deleteProject: vi.fn(),
    getLatestTimesheet: vi.fn(),
    getTimesheet: vi.fn(),
    deleteTimesheet: vi.fn(),
    createUser: vi.fn(),
    getProfileById: vi.fn(),
    updateUserStatus: vi.fn(),
    updateUserRole: vi.fn(),
    updateUserName: vi.fn(),
    updateMyProfile: vi.fn(),
    createActivityType: vi.fn(),
    renameActivityType: vi.fn(),
    setActivityTypeActive: vi.fn(),
    setActivityTypeTelegramNo: vi.fn(),
    deleteActivityType: vi.fn(),
    createGlobalReminder: vi.fn(),
    deleteGlobalReminder: vi.fn(),
    dismissGlobalReminder: vi.fn(),
    setBackfillWindow: vi.fn(),
    setDashboardLayout: vi.fn(),
    deleteUserTimesheets: vi.fn(),
    listProfiles: vi.fn(),
    listProjects: vi.fn(),
    listAllActivityTypes: vi.fn(),
    getTimesheetDailyTotals: vi.fn(),
    importTimesheets: vi.fn(),
    writeAuditLog: vi.fn(),
    listTitles: vi.fn(),
    addTitle: vi.fn(),
    deleteTitle: vi.fn(),
    updateUserHierarchy: vi.fn(),
  },
}))

import {
  addActivityType,
  addGlobalReminder,
  addProject,
  addTitle,
  addUser,
  amISuperAdmin,
  deleteActivityType,
  deleteGlobalReminder,
  deleteLastEntry,
  deleteProject,
  deleteTimesheet,
  deleteTitle,
  deleteUserTimesheets,
  dismissGlobalReminder,
  getTitles,
  importTimesheets,
  renameActivityType,
  renameProject,
  saveDashboardLayout,
  setActivityTypeActive,
  setActivityTypeTelegramNo,
  setBackfillWindow,
  setProjectSO,
  setProjectTelegramNo,
  toggleUserStatus,
  updateMyProfile,
  updateUserRole,
  updateUserHierarchy,
  updateUserName,
} from '../app/actions'
import { getActor } from '@/lib/auth'
import { repo } from '@/lib/db'
import { TILE_IDS } from '../app/constants'

const admin = { id: 'a1', email: 'super@x.com', role: 'admin' as UserRole, isActive: true }
const pm = { id: 'pm1', email: 'pm@x.com', role: 'pm' as UserRole, isActive: true }
const user = { id: 'u1', email: 'user@x.com', role: 'user' as UserRole, isActive: true }

type MockRepo = { [k: string]: ReturnType<typeof vi.fn> }
const mockRepo = repo as unknown as MockRepo
const mockGetActor = vi.mocked(getActor)

function ok() {
  for (const k of Object.keys(mockRepo)) mockRepo[k].mockResolvedValue({ error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  ok()
  mockGetActor.mockResolvedValue(admin)
})

describe('project actions', () => {
  it('addProject creates a project as an admin/pm', async () => {
    mockGetActor.mockResolvedValue(pm)
    expect(await addProject('  Alpha  ')).toEqual({})
    expect(mockRepo.createProject).toHaveBeenCalledWith(pm, 'Alpha')
  })

  it('addProject rejects an empty name and non-admins', async () => {
    expect(await addProject('   ')).toEqual({ error: expect.any(String) })
    mockGetActor.mockResolvedValue(user)
    expect(await addProject('Alpha')).toEqual({ error: expect.stringContaining('permission') })
  })

  it('renameProject, setProjectSO, setProjectTelegramNo, deleteProject', async () => {
    expect(await renameProject('p1', 'Beta')).toEqual({})
    expect(mockRepo.renameProject).toHaveBeenCalledWith(admin, 'p1', 'Beta')

    expect(await setProjectSO('p1', 'SO-1')).toEqual({})
    expect(mockRepo.setProjectSO).toHaveBeenCalledWith(admin, 'p1', 'SO-1')

    expect(await setProjectTelegramNo('p1', 5)).toEqual({})
    expect(mockRepo.setProjectTelegramNo).toHaveBeenCalledWith(admin, 'p1', 5)
    expect(await setProjectTelegramNo('p1', 0)).toEqual({ error: expect.stringContaining('positive') })

    expect(await deleteProject('p1')).toEqual({})
    expect(mockRepo.deleteProject).toHaveBeenCalledWith(admin, 'p1')
  })
})

describe('deleteLastEntry / deleteTimesheet', () => {
  it('deleteLastEntry reports when there is nothing to undo and deletes the latest', async () => {
    mockRepo.getLatestTimesheet.mockResolvedValue(null)
    expect(await deleteLastEntry()).toEqual({ error: 'No entries to undo.' })

    mockRepo.getLatestTimesheet.mockResolvedValue({ id: 'e1' })
    expect(await deleteLastEntry()).toEqual({})
    expect(mockRepo.deleteTimesheet).toHaveBeenCalledWith(admin, 'e1')
  })

  it('deleteTimesheet blocks deleting another user\'s entry for regular users', async () => {
    mockRepo.getTimesheet.mockResolvedValue({ id: 'e1', user_id: 'other' })
    mockGetActor.mockResolvedValue(user)
    expect(await deleteTimesheet('e1')).toEqual({ error: 'You can only delete your own entries.' })
    expect(mockRepo.deleteTimesheet).not.toHaveBeenCalled()
  })

  it('deleteTimesheet lets an admin delete another user\'s entry', async () => {
    mockRepo.getTimesheet.mockResolvedValue({ id: 'e1', user_id: 'other' })
    expect(await deleteTimesheet('e1')).toEqual({})
    expect(mockRepo.deleteTimesheet).toHaveBeenCalledWith(admin, 'e1')
  })
})

describe('user admin', () => {
  const input = {
    email: ' JANE@EXAMPLE.COM ',
    password: 'Secret123',
    name: ' Jane ',
    department: ' Eng ',
    title: ' ML ',
    role: 'user' as UserRole,
    isActive: true,
  }

  it('addUser validates role, password and delegates normalized email', async () => {
    expect(await addUser({ ...input, role: 'bogus' as UserRole })).toEqual({ error: 'Invalid role.' })
    expect(await addUser({ ...input, password: 'short' })).toEqual({ error: expect.stringContaining('8 characters') })
    expect(await addUser(input)).toEqual({})
    expect(mockRepo.createUser).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ email: 'jane@example.com', name: 'Jane' })
    )
  })

  it('toggleUserStatus guards self-deactivation and missing users', async () => {
    mockRepo.getProfileById.mockResolvedValue({ id: 'a1', is_active: true })
    expect(await toggleUserStatus('a1')).toEqual({ error: 'You cannot deactivate your own account.' })

    mockRepo.getProfileById.mockResolvedValue(null)
    expect(await toggleUserStatus('u2')).toEqual({ error: 'User not found.' })

    mockRepo.getProfileById.mockResolvedValue({ id: 'u2', is_active: false })
    expect(await toggleUserStatus('u2')).toEqual({})
    expect(mockRepo.updateUserStatus).toHaveBeenCalledWith(admin, 'u2', true)
  })

  it('updateUserRole blocks self-change and invalid roles', async () => {
    expect(await updateUserRole('a1', 'user')).toEqual({ error: 'You cannot change your own role.' })
    expect(await updateUserRole('u2', 'bogus' as UserRole)).toEqual({ error: 'Invalid role.' })
    expect(await updateUserRole('u2', 'admin')).toEqual({})
    expect(mockRepo.updateUserRole).toHaveBeenCalledWith(admin, 'u2', 'admin')
  })

  it('updateUserName requires a name', async () => {
    expect(await updateUserName('u2', '  ')).toEqual({ error: 'Name is required.' })
    expect(await updateUserName('u2', ' Bob ')).toEqual({})
    expect(mockRepo.updateUserName).toHaveBeenCalledWith(admin, 'u2', 'Bob')
  })

  it('updateMyProfile requires a session', async () => {
    mockGetActor.mockResolvedValue(null)
    expect(await updateMyProfile({ department: 'Eng', title: 'ML' })).toEqual({ error: 'You must be signed in.' })
    mockGetActor.mockResolvedValue(admin)
    expect(await updateMyProfile({ department: ' Eng ', title: ' ML ' })).toEqual({})
    expect(mockRepo.updateMyProfile).toHaveBeenCalledWith(admin, { department: 'Eng', title: 'ML' })
  })

  it('deleteUserTimesheets delegates for an admin', async () => {
    expect(await deleteUserTimesheets('u2')).toEqual({})
    expect(mockRepo.deleteUserTimesheets).toHaveBeenCalledWith(admin, 'u2')
  })
})

describe('activity type actions', () => {
  it('CRUD and telegram number', async () => {
    expect(await addActivityType('  R&D  ')).toEqual({})
    expect(mockRepo.createActivityType).toHaveBeenCalledWith(admin, 'R&D')
    expect(await renameActivityType('at1', 'Dev')).toEqual({})
    expect(mockRepo.renameActivityType).toHaveBeenCalledWith(admin, 'at1', 'Dev')
    expect(await setActivityTypeActive('at1', false)).toEqual({})
    expect(mockRepo.setActivityTypeActive).toHaveBeenCalledWith(admin, 'at1', false)
    expect(await setActivityTypeTelegramNo('at1', 7)).toEqual({})
    expect(mockRepo.setActivityTypeTelegramNo).toHaveBeenCalledWith(admin, 'at1', 7)
    expect(await setActivityTypeTelegramNo('at1', -1)).toEqual({ error: expect.stringContaining('positive') })
  })
})

describe('global reminders + backfill + layout', () => {
  it('addGlobalReminder validates and creates', async () => {
    expect(await addGlobalReminder({ message: ' ', remindAt: '2026-01-01T00:00:00Z' })).toEqual({
      error: 'Message and time are required.',
    })
    expect(await addGlobalReminder({ message: 'm', remindAt: 'not-a-date' })).toEqual({ error: 'Invalid reminder time.' })
    expect(await addGlobalReminder({ message: ' hello ', remindAt: '2026-01-01T00:00:00Z' })).toEqual({})
    expect(mockRepo.createGlobalReminder).toHaveBeenCalledWith(admin, {
      message: 'hello',
      remindAt: '2026-01-01T00:00:00.000Z',
    })
    expect(await deleteGlobalReminder('g1')).toEqual({})
    expect(mockRepo.deleteGlobalReminder).toHaveBeenCalledWith(admin, 'g1')
  })

  it('dismissGlobalReminder requires a session', async () => {
    mockGetActor.mockResolvedValueOnce(null)
    expect(await dismissGlobalReminder('g1')).toEqual({ error: 'You must be signed in.' })
    expect(await dismissGlobalReminder('g1')).toEqual({})
    expect(mockRepo.dismissGlobalReminder).toHaveBeenCalledWith(admin, 'g1')
  })

  it('setBackfillWindow validates mode and day ranges', async () => {
    expect(await setBackfillWindow({ mode: 'bogus' as never, windowDays: 1, extraDays: 0 })).toEqual({
      error: 'Invalid backfill mode.',
    })
    expect(await setBackfillWindow({ mode: 'days', windowDays: 500, extraDays: 0 })).toEqual({
      error: expect.stringContaining('0 and 365'),
    })
    expect(await setBackfillWindow({ mode: 'days', windowDays: 3, extraDays: 1 })).toEqual({})
    expect(mockRepo.setBackfillWindow).toHaveBeenCalledWith(admin, { mode: 'days', windowDays: 3, extraDays: 1 })
  })

  it('saveDashboardLayout validates the tile set', async () => {
    expect(await saveDashboardLayout({ tiles: [] as never })).toEqual({ error: 'Invalid layout.' })
    // valid layout uses every TILE_ID exactly once
    const layout = { tiles: TILE_IDS.map((id) => ({ id, enabled: true })) }
    expect(await saveDashboardLayout(layout)).toEqual({})
    expect(mockRepo.setDashboardLayout).toHaveBeenCalledWith(admin, layout)
  })
})

describe('super-admin deletes', () => {
  const superAdmin = { ...admin, email: 'super@x.com', role: 'admin' as UserRole }

  it('amISuperAdmin reflects the configured account', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue(superAdmin)
    expect(await amISuperAdmin()).toEqual({ isSuperAdmin: true })
    mockGetActor.mockResolvedValue(user)
    expect(await amISuperAdmin()).toEqual({ isSuperAdmin: false })
  })

  it('deleteActivityType only for the super-admin', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockGetActor.mockResolvedValue(user)
    expect(await deleteActivityType('at1')).toEqual({ error: expect.stringContaining('permission') })
    mockGetActor.mockResolvedValue(superAdmin)
    expect(await deleteActivityType('at2')).toEqual({})
    expect(mockRepo.deleteActivityType).toHaveBeenCalledWith(superAdmin, 'at2')
  })
})

describe('importTimesheets', () => {
  const actor = admin
  beforeEach(() => {
    mockRepo.listProfiles.mockResolvedValue([{ id: 'u1', email: 'jane@example.com' }])
    mockRepo.listProjects.mockResolvedValue([{ id: 'p1', name: 'Alpha' }])
    mockRepo.listAllActivityTypes.mockResolvedValue([
      { id: 't1', name: 'R&D' },
      { id: 't2', name: '' },
    ])
    mockRepo.getTimesheetDailyTotals.mockResolvedValue([])
    mockRepo.importTimesheets.mockResolvedValue({ error: null, imported: 1 })
  })

  it('rejects empty and oversized input', async () => {
    expect(await importTimesheets([])).toEqual({ error: 'No rows to import.' })
    expect(await importTimesheets(new Array(2001).fill({}))).toEqual({ error: 'Too many rows (max 2000).' })
  })

  it('imports valid rows and filters unknown references', async () => {
    const result = await importTimesheets([
      { email: 'jane@example.com', logDate: '2026-08-01', project: 'Alpha', activityType: 'R&D', hours: '8', workDone: 'did work' },
      { email: 'ghost@example.com', logDate: '2026-08-01', project: 'Alpha', activityType: 'R&D', hours: '8', workDone: 'x' },
      { email: 'jane@example.com', logDate: '2026-08-01', project: 'Nope', activityType: 'R&D', hours: '8', workDone: 'x' },
      { email: 'jane@example.com', logDate: 'bad-date', project: 'Alpha', activityType: 'R&D', hours: '8', workDone: 'x' },
      { email: 'jane@example.com', logDate: '2026-08-01', project: 'Alpha', activityType: 'R&D', hours: '0', workDone: 'x' },
    ])
    expect(result.imported).toBeGreaterThan(0)
    expect(mockRepo.importTimesheets).toHaveBeenCalledTimes(1)
  })

  it('skips rows exceeding the 24h daily cap', async () => {
    mockRepo.getTimesheetDailyTotals.mockResolvedValue([{ userId: 'u1', logDate: '2026-08-01', hours: 20 }])
    const result = await importTimesheets([
      { email: 'jane@example.com', logDate: '2026-08-01', project: 'Alpha', activityType: 'R&D', hours: '8', workDone: 'x' },
    ])
    expect(result.error).toBeUndefined()
    expect(mockRepo.importTimesheets).toHaveBeenCalledWith(actor, [])
  })

  it('errors when nothing imports', async () => {
    const result = await importTimesheets([
      { email: 'ghost@example.com', logDate: '2026-08-01', project: 'Alpha', activityType: 'R&D', hours: '8', workDone: 'x' },
    ])
    expect(result.error).toBe('Nothing to import.')
  })
})

describe('titles & hierarchy actions', () => {
  it('allows admins to update user hierarchy', async () => {
    mockRepo.listProfiles.mockResolvedValue([])
    mockRepo.updateUserHierarchy.mockResolvedValue({ error: null })
    mockRepo.writeAuditLog.mockResolvedValue({ error: null })

    const res = await updateUserHierarchy('u2', {
      managerId: 'u1',
      title: 'Systems Engineer',
      role: 'user',
    })
    expect(res.error).toBeUndefined()
    expect(mockRepo.updateUserHierarchy).toHaveBeenCalledWith(admin, 'u2', {
      managerId: 'u1',
      title: 'Systems Engineer',
      role: 'user',
    })
  })

  it('rejects title addition for non-super-admin', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'other@example.com')
    // admin email is super@x.com, not other@example.com
    const res = await addTitle('Architect')
    expect(res.error).toBe('Super-admin access required.')
  })

  it('allows super-admin to add and delete titles', async () => {
    vi.stubEnv('SUPER_ADMIN_EMAIL', 'super@x.com')
    mockRepo.addTitle.mockResolvedValue({ error: null })
    mockRepo.deleteTitle.mockResolvedValue({ error: null })
    mockRepo.writeAuditLog.mockResolvedValue({ error: null })

    const addRes = await addTitle('Lead Architect')
    expect(addRes.error).toBeUndefined()

    const delRes = await deleteTitle('Lead Architect')
    expect(delRes.error).toBeUndefined()
  })

  it('allows any user to fetch titles', async () => {
    mockRepo.listTitles.mockResolvedValue(['Intern', 'Systems Engineer'])
    const res = await getTitles()
    expect(res.titles).toEqual(['Intern', 'Systems Engineer'])
  })
})

