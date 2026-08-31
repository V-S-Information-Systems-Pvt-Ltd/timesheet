import type { IconName } from '../components/Icon';
import type { ActorCapabilities } from '../api/contracts';

export type RootTab = 'dashboard' | 'timesheets' | 'log-time' | 'reports' | 'more';
export type ChildScreen =
  | 'leaves'
  | 'reminders'
  | 'team'
  | 'profile'
  | 'edit-time'
  | 'layout-customizer'
  | 'admin-projects'
  | 'admin-activities'
  | 'admin-users'
  | 'admin-settings'
  | 'admin-leaves'
  | 'admin-reminders'
  | 'admin-reports';

export type AppRoute = RootTab | ChildScreen;

export interface RouteMeta {
  key: AppRoute;
  title: string;
  backLabel: string;
  parentTab: RootTab;
  icon: IconName;
  requiredCapability?: keyof ActorCapabilities;
  isRootTab: boolean;
  isAction?: boolean;
}

export const ROUTE_REGISTRY: Record<AppRoute, RouteMeta> = {
  dashboard: {
    key: 'dashboard',
    title: 'Dashboard',
    backLabel: '‹ Dashboard',
    parentTab: 'dashboard',
    icon: 'home',
    isRootTab: true,
  },
  timesheets: {
    key: 'timesheets',
    title: 'Timesheets',
    backLabel: '‹ Timesheets',
    parentTab: 'timesheets',
    icon: 'clock',
    isRootTab: true,
  },
  'log-time': {
    key: 'log-time',
    title: 'Log Time',
    backLabel: '‹ Back',
    parentTab: 'log-time',
    icon: 'plus',
    isRootTab: true,
    isAction: true,
  },
  reports: {
    key: 'reports',
    title: 'Reports',
    backLabel: '‹ Reports',
    parentTab: 'reports',
    icon: 'reports',
    isRootTab: true,
  },
  more: {
    key: 'more',
    title: 'More',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'more',
    isRootTab: true,
  },
  leaves: {
    key: 'leaves',
    title: 'Mark Leave',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'calendar',
    isRootTab: false,
  },
  reminders: {
    key: 'reminders',
    title: 'Reminders',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'bell',
    isRootTab: false,
  },
  team: {
    key: 'team',
    title: 'Team Directory',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'team',
    requiredCapability: 'canViewTeam',
    isRootTab: false,
  },
  profile: {
    key: 'profile',
    title: 'Profile & Security',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'profile',
    isRootTab: false,
  },
  'edit-time': {
    key: 'edit-time',
    title: 'Edit Time',
    backLabel: '‹ Timesheets',
    parentTab: 'timesheets',
    icon: 'edit',
    isRootTab: false,
  },
  'layout-customizer': {
    key: 'layout-customizer',
    title: 'Customize Layout',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'edit',
    isRootTab: false,
  },
  'admin-projects': {
    key: 'admin-projects',
    title: 'Project Management',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'folder',
    requiredCapability: 'canManageProjects',
    isRootTab: false,
  },
  'admin-activities': {
    key: 'admin-activities',
    title: 'Activity Types',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'tag',
    requiredCapability: 'canManageActivities',
    isRootTab: false,
  },
  'admin-users': {
    key: 'admin-users',
    title: 'User Management',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'team',
    requiredCapability: 'canManageUsers',
    isRootTab: false,
  },
  'admin-settings': {
    key: 'admin-settings',
    title: 'Workspace Settings',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'lock',
    requiredCapability: 'canManageSettings',
    isRootTab: false,
  },
  'admin-leaves': {
    key: 'admin-leaves',
    title: 'Leave Administration',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'calendar',
    requiredCapability: 'canManageSettings',
    isRootTab: false,
  },
  'admin-reminders': {
    key: 'admin-reminders',
    title: 'Global Reminders',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'bell',
    requiredCapability: 'canManageSettings',
    isRootTab: false,
  },
  'admin-reports': {
    key: 'admin-reports',
    title: 'Privileged Reports',
    backLabel: '‹ More',
    parentTab: 'more',
    icon: 'reports',
    requiredCapability: 'canManageSettings',
    isRootTab: false,
  },
};

export const ROOT_TABS: RootTab[] = ['dashboard', 'timesheets', 'log-time', 'reports', 'more'];

export function canAccessRoute(route: AppRoute, capabilities?: ActorCapabilities | null): boolean {
  const meta = ROUTE_REGISTRY[route];
  if (!meta.requiredCapability) return true;
  if (!capabilities) return false;
  return Boolean(capabilities[meta.requiredCapability]);
}
