import type { IconName } from '../components/Icon';
import type { ActorCapabilities } from '../api/contracts';

export type RootTab = 'dashboard' | 'timesheets' | 'log-time' | 'reports' | 'more';
export type ChildScreen = 'leaves' | 'reminders' | 'team' | 'profile';
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
};

export const ROOT_TABS: RootTab[] = ['dashboard', 'timesheets', 'log-time', 'reports', 'more'];

export function canAccessRoute(route: AppRoute, capabilities?: ActorCapabilities | null): boolean {
  const meta = ROUTE_REGISTRY[route];
  if (!meta.requiredCapability) return true;
  if (!capabilities) return false;
  return Boolean(capabilities[meta.requiredCapability]);
}
