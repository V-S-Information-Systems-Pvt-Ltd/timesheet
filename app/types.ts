// app/types.ts
export type UserRole = 'admin' | 'pm' | 'co' | 'user'

export interface User {
  id: string;
  email: string;
  name: string;
  department: string;
  title: string;
  role: UserRole;
  is_active: boolean;
}

export interface Project {
  id: string;
  name: string;
}

export interface Timesheet {
  id: string;
  user_id: string;
  project_id: string;
  log_date: string;
  hours_worked: number;
  work_done: string;
  projects?: { name: string };
  profiles?: { email: string };
}
