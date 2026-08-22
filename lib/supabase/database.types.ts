// lib/supabase/database.types.ts
// Supabase Database types, written to match the migrations in
// supabase/migrations/ (see 20260810160000 … 20260814000000).
//
// Keep this file in sync with the schema; it can be regenerated from a live
// database with `npx supabase gen types typescript --project-id <ref> > lib/supabase/database.types.ts`
// (the `role` column is declared as a literal union here because the CHECK
// constraint on profiles.role is not reflected in generated output).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'admin' | 'pm' | 'co' | 'manager' | 'team_lead' | 'user'
export type PermissionRole = 'admin' | 'pm' | 'co' | 'user'
export type HierarchyRole = 'manager' | 'team_lead' | 'user'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          name: string
          department: string
          title: string
          role: UserRole
          permission_role: PermissionRole
          hierarchy_role: HierarchyRole
          is_active: boolean
          manager_id: string | null
          dashboard_layout: Json | null
          admin_layout: Json | null
          created_at: string
        }
        Insert: {
          id: string
          email: string
          name?: string
          department?: string
          title?: string
          role?: UserRole
          permission_role?: PermissionRole
          hierarchy_role?: HierarchyRole
          is_active?: boolean
          manager_id?: string | null
          dashboard_layout?: Json | null
          admin_layout?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          name?: string
          department?: string
          title?: string
          role?: UserRole
          permission_role?: PermissionRole
          hierarchy_role?: HierarchyRole
          is_active?: boolean
          manager_id?: string | null
          dashboard_layout?: Json | null
          admin_layout?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          id: string
          name: string
          so_number: string | null
          telegram_no: number | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          so_number?: string | null
          telegram_no?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          so_number?: string | null
          telegram_no?: number | null
          created_at?: string
        }
        Relationships: []
      }
      timesheets: {
        Row: {
          id: string
          user_id: string
          project_id: string
          activity_type_id: string | null
          log_date: string
          hours_worked: number
          work_done: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          project_id: string
          activity_type_id?: string | null
          log_date: string
          hours_worked: number
          work_done: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          project_id?: string
          activity_type_id?: string | null
          log_date?: string
          hours_worked?: number
          work_done?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'timesheets_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timesheets_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timesheets_activity_type_id_fkey'
            columns: ['activity_type_id']
            isOneToOne: false
            referencedRelation: 'activity_types'
            referencedColumns: ['id']
          }
        ]
      }
      leaves: {
        Row: {
          id: string
          user_id: string
          leave_date: string
          reason: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          leave_date: string
          reason?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          leave_date?: string
          reason?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'leaves_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      reminders: {
        Row: {
          id: string
          user_id: string
          message: string
          remind_at: string
          done: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          message: string
          remind_at: string
          done?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          message?: string
          remind_at?: string
          done?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'reminders_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      activity_types: {
        Row: {
          id: string
          name: string
          is_active: boolean
          telegram_no: number | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          is_active?: boolean
          telegram_no?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          is_active?: boolean
          telegram_no?: number | null
          created_at?: string
        }
        Relationships: []
      }
      global_reminders: {
        Row: {
          id: string
          message: string
          remind_at: string
          created_at: string
        }
        Insert: {
          id?: string
          message: string
          remind_at: string
          created_at?: string
        }
        Update: {
          id?: string
          message?: string
          remind_at?: string
          created_at?: string
        }
        Relationships: []
      }
      global_reminder_dismissals: {
        Row: {
          user_id: string
          reminder_id: string
          dismissed_at: string
        }
        Insert: {
          user_id: string
          reminder_id: string
          dismissed_at?: string
        }
        Update: {
          user_id?: string
          reminder_id?: string
          dismissed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'global_reminder_dismissals_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'global_reminder_dismissals_reminder_id_fkey'
            columns: ['reminder_id']
            isOneToOne: false
            referencedRelation: 'global_reminders'
            referencedColumns: ['id']
          }
        ]
      }
      app_settings: {
        Row: {
          id: number
          backfill_window_days: number
          backfill_mode: 'days' | 'month_start'
          backfill_extra_days: number
          default_dashboard_layout: Json | null
          default_admin_layout: Json | null
          updated_at: string
        }
        Insert: {
          id?: number
          backfill_window_days?: number
          backfill_mode?: 'days' | 'month_start'
          backfill_extra_days?: number
          default_dashboard_layout?: Json | null
          default_admin_layout?: Json | null
          updated_at?: string
        }
        Update: {
          id?: number
          backfill_window_days?: number
          backfill_mode?: 'days' | 'month_start'
          backfill_extra_days?: number
          default_dashboard_layout?: Json | null
          default_admin_layout?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          id: string
          actor_id: string | null
          actor_email: string
          action: string
          target_id: string | null
          detail: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          actor_id?: string | null
          actor_email: string
          action: string
          target_id?: string | null
          detail?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          actor_id?: string | null
          actor_email?: string
          action?: string
          target_id?: string | null
          detail?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      whitelisted_domains: {
        Row: {
          id: string
          domain: string
          auto_activate: boolean
          created_at: string
        }
        Insert: {
          id?: string
          domain: string
          auto_activate?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          domain?: string
          auto_activate?: boolean
          created_at?: string
        }
        Relationships: []
      }
      titles: {
        Row: {
          id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: { role_name: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
