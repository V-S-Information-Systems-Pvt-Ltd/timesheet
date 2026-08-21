// app/hooks/use-data.ts
// Custom hook for dashboard data fetching, caching, and optimistic mutations.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { authClient, type ClientSessionUser } from '@/lib/auth/client'
import { dataClient } from '@/lib/data/client'
import { amISuperAdmin } from '@/app/actions'
import type { ActivityType, OptimisticTimesheet, Project, Timesheet, User } from '@/app/types'
import type { BackfillSettings } from '@/lib/validation'

const DEFAULT_BACKFILL: BackfillSettings = { mode: 'days', windowDays: 1, extraDays: 0 }

export function useDashboardData() {
  const [user, setUser] = useState<ClientSessionUser | null>(null)
  const [profile, setProfile] = useState<User | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([])
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [backfillSettings, setBackfillSettings] = useState<BackfillSettings>(DEFAULT_BACKFILL)
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [superAdmin, setSuperAdmin] = useState(false)
  const fetchSeqRef = useRef(0)

  const fetchProjects = useCallback(async () => {
    const { data, error } = await dataClient.getProjects()
    if (error) { setDataError(error); return }
    setDataError(null)
    if (data) setProjects(data)
  }, [])

  const fetchActivityTypes = useCallback(async () => {
    const { data, error } = await dataClient.getActivityTypes()
    if (error) { setDataError(error); return }
    setDataError(null)
    if (data) setActivityTypes(data)
  }, [])

  const fetchTimesheets = useCallback(async () => {
    const seq = ++fetchSeqRef.current
    const { data, error } = await dataClient.getTimesheets()
    if (error) {
      setDataError(error)
      return false
    }
    setDataError(null)
    if (seq === fetchSeqRef.current && data) setTimesheets(data)
    return seq === fetchSeqRef.current
  }, [])

  const fetchAllUsers = useCallback(async () => {
    const { data, error } = await dataClient.getAllUsers()
    if (error) { setDataError(error); return }
    setDataError(null)
    if (data) setAllUsers(data)
  }, [])

  const fetchBackfillWindow = useCallback(async () => {
    const { data } = await dataClient.getBackfillWindow()
    if (data) setBackfillSettings(data)
  }, [])

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await dataClient.getProfile(userId)
    if (error) { setDataError(error); return }
    setDataError(null)
    if (data) {
      setProfile(data)
      if (data.is_active) {
        fetchProjects()
        fetchActivityTypes()
        fetchTimesheets()
        if (data.role === 'admin' || data.role === 'co' || data.role === 'manager' || data.role === 'team_lead') {
          fetchAllUsers()
        }
        fetchBackfillWindow()
        if (data.role === 'admin') {
          amISuperAdmin().then(({ isSuperAdmin }) => setSuperAdmin(isSuperAdmin))
        }
      }
    }
  }, [fetchAllUsers, fetchBackfillWindow, fetchProjects, fetchActivityTypes, fetchTimesheets])

  useEffect(() => {
    const unsubscribe = authClient.onAuthStateChange(async (sessionUser) => {
      if (sessionUser) {
        setUser(sessionUser)
        await fetchProfile(sessionUser.id)
      } else {
        setUser(null)
        setProfile(null)
        setProjects([])
        setTimesheets([])
        setAllUsers([])
        setDataError(null)
      }
      setLoading(false)
    })

    return unsubscribe
  }, [fetchProfile])

  const handleLogged = useCallback(async (optimistic?: OptimisticTimesheet) => {
    if (optimistic) {
      const entry: Timesheet = {
        id: optimistic.tempId,
        user_id: user?.id ?? '',
        project_id: optimistic.project_id,
        activity_type_id: optimistic.activity_type_id,
        log_date: optimistic.log_date,
        hours_worked: optimistic.hours_worked,
        work_done: optimistic.work_done,
        created_at: new Date().toISOString(),
      }
      setTimesheets(prev => [entry, ...prev])
    }
    const ok = await fetchTimesheets()
    if (!ok && optimistic) {
      setTimesheets(prev => prev.filter(t => t.id !== optimistic.tempId))
    }
  }, [fetchTimesheets, user?.id])

  const signOut = useCallback(async () => {
    await authClient.signOut()
    setUser(null)
    setProfile(null)
    setTimesheets([])
    setProjects([])
    setAllUsers([])
    setDataError(null)
  }, [])

  return {
    user,
    profile,
    setProfile,
    projects,
    activityTypes,
    timesheets,
    setTimesheets,
    allUsers,
    backfillSettings,
    setBackfillSettings,
    loading,
    dataError,
    superAdmin,
    fetchProjects,
    fetchActivityTypes,
    fetchTimesheets,
    fetchAllUsers,
    fetchProfile,
    handleLogged,
    signOut,
  }
}
