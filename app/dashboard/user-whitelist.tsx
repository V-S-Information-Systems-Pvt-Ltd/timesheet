// app/dashboard/user-whitelist.tsx
'use client'

import { toggleUserStatus, updateUserRole } from '../actions'
import { User, UserRole } from '../types'
import { ROLES } from '../constants'
import { Card, RoleBadge, Td, Th} from '@/app/components/ui'
import { toast } from '@/app/components/toast'
import { IconUsers } from '@/app/components/icons'

export default function UserWhitelist({
  allUsers,
  selfId,
  onChanged,
}: {
  allUsers: User[]
  selfId?: string
  onChanged: () => void
}) {
  const handleToggleStatus = async (userId: string) => {
    const { error } = await toggleUserStatus(userId)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('User status updated.', 'success')
    }
  }

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    const { error } = await updateUserRole(userId, newRole)
    if (error) toast(error, 'error')
    else {
      onChanged()
      toast('Role updated.', 'success')
    }
  }

  return (
    <Card
      title="User Whitelist"
      subtitle="Manage roles and account activation"
      icon={<IconUsers className="h-4.5 w-4.5" />}
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Department</Th>
              <Th>Title</Th>
              <Th>Role</Th>
              <Th className="text-center">Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {allUsers.map(u => (
              <tr key={u.id} className="transition-colors hover:bg-slate-50/70">
                <Td className="font-medium text-slate-800">{u.name || '—'}</Td>
                <Td className="text-slate-500">{u.email}</Td>
                <Td className="text-slate-500">{u.department || '—'}</Td>
                <Td className="text-slate-500">{u.title || '—'}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <RoleBadge role={u.role} />
                    <select
                      value={u.role}
                      disabled={u.id === selfId}
                      onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                      className="cursor-pointer rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 disabled:opacity-40"
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </Td>
                <Td className="text-center">
                  <button
                    onClick={() => handleToggleStatus(u.id)}
                    disabled={u.id === selfId && u.is_active}
                    title={u.id === selfId && u.is_active ? 'You cannot deactivate your own account' : undefined}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      u.is_active
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${u.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {u.is_active ? 'Active' : 'Inactive'}
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
