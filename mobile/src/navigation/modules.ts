import type { IconName } from '../components/Icon';
import type {
  ActorCapabilities,
  MobileLayout,
  MobileModuleId,
  MobileModuleSetting,
} from '../api/contracts';
import type { AppRoute } from './routes';

export interface ModuleMeta {
  id: MobileModuleId;
  route: AppRoute;
  title: string;
  description: string;
  icon: IconName;
  requiredCapability?: keyof ActorCapabilities;
  defaultPlacement: 'home' | 'more';
  isEssential: boolean;
}

export const ESSENTIAL_MODULE_IDS: readonly MobileModuleId[] = [
  'log-time',
  'timesheets',
  'profile',
];

export const MODULE_REGISTRY: Record<MobileModuleId, ModuleMeta> = {
  'log-time': {
    id: 'log-time',
    route: 'log-time',
    title: 'Log Time',
    description: 'Track daily hours worked on projects',
    icon: 'plus',
    defaultPlacement: 'home',
    isEssential: true,
  },
  timesheets: {
    id: 'timesheets',
    route: 'timesheets',
    title: 'Timesheets',
    description: 'View, edit, and duplicate time entries',
    icon: 'clock',
    defaultPlacement: 'home',
    isEssential: true,
  },
  reports: {
    id: 'reports',
    route: 'reports',
    title: 'Reports',
    description: 'Weekly summaries, totals, and export',
    icon: 'reports',
    defaultPlacement: 'home',
    isEssential: false,
  },
  leaves: {
    id: 'leaves',
    route: 'leaves',
    title: 'Mark Leave',
    description: 'Plan leaves and view past leave records',
    icon: 'calendar',
    defaultPlacement: 'home',
    isEssential: false,
  },
  reminders: {
    id: 'reminders',
    route: 'reminders',
    title: 'Reminders',
    description: 'Personal timesheet and submission reminders',
    icon: 'bell',
    defaultPlacement: 'more',
    isEssential: false,
  },
  team: {
    id: 'team',
    route: 'team',
    title: 'Team Directory',
    description: 'Hierarchy tree and member directory',
    icon: 'team',
    requiredCapability: 'canViewTeam',
    defaultPlacement: 'more',
    isEssential: false,
  },
  profile: {
    id: 'profile',
    route: 'profile',
    title: 'Profile & Security',
    description: 'Account settings, password, and security',
    icon: 'profile',
    defaultPlacement: 'more',
    isEssential: true,
  },
  'admin-projects': {
    id: 'admin-projects',
    route: 'admin-projects',
    title: 'Project Management',
    description: 'Create and configure workspace projects',
    icon: 'folder',
    requiredCapability: 'canManageProjects',
    defaultPlacement: 'more',
    isEssential: false,
  },
  'admin-activities': {
    id: 'admin-activities',
    route: 'admin-activities',
    title: 'Activity Types',
    description: 'Manage activity categories and telegram codes',
    icon: 'tag',
    requiredCapability: 'canManageActivities',
    defaultPlacement: 'more',
    isEssential: false,
  },
  'admin-users': {
    id: 'admin-users',
    route: 'admin-users',
    title: 'User Management',
    description: 'Provision accounts and assign roles & titles',
    icon: 'team',
    requiredCapability: 'canManageUsers',
    defaultPlacement: 'more',
    isEssential: false,
  },
  'admin-settings': {
    id: 'admin-settings',
    route: 'admin-settings',
    title: 'Workspace Settings',
    description: 'Branding, backfill policy, and layout defaults',
    icon: 'lock',
    requiredCapability: 'canManageSettings',
    defaultPlacement: 'more',
    isEssential: false,
  },
  'admin-leaves': {
    id: 'admin-leaves',
    route: 'admin-leaves',
    title: 'Leave Administration',
    description: 'Manage team leaves and global records',
    icon: 'calendar',
    requiredCapability: 'canManageSettings',
    defaultPlacement: 'more',
    isEssential: false,
  },
  'admin-reminders': {
    id: 'admin-reminders',
    route: 'admin-reminders',
    title: 'Global Reminders',
    description: 'Publish company-wide reminder alerts',
    icon: 'bell',
    requiredCapability: 'canManageSettings',
    defaultPlacement: 'more',
    isEssential: false,
  },
  'admin-reports': {
    id: 'admin-reports',
    route: 'admin-reports',
    title: 'Privileged Reports',
    description: 'Organization-wide hours and CSV export',
    icon: 'reports',
    requiredCapability: 'canManageSettings',
    defaultPlacement: 'more',
    isEssential: false,
  },
};

export const DEFAULT_MOBILE_LAYOUT: MobileLayout = {
  modules: Object.values(MODULE_REGISTRY).map((meta) => ({
    id: meta.id,
    enabled: true,
    placement: meta.defaultPlacement,
  })),
};

export function resolveEffectiveLayout(
  saved: MobileLayout | null | undefined,
  defaults: MobileLayout = DEFAULT_MOBILE_LAYOUT,
  capabilities?: ActorCapabilities | null
): MobileLayout {
  const defaultMap = new Map(defaults.modules.map((m) => [m.id, m]));
  const savedModules: MobileModuleSetting[] = [];
  const seen = new Set<MobileModuleId>();

  for (const m of saved?.modules ?? []) {
    if (defaultMap.has(m.id) && !seen.has(m.id)) {
      seen.add(m.id);
      const def = defaultMap.get(m.id)!;
      const isEssential = ESSENTIAL_MODULE_IDS.includes(m.id);
      savedModules.push({
        id: m.id,
        enabled: isEssential ? true : Boolean(m.enabled),
        placement:
          m.placement === 'home' || m.placement === 'more'
            ? m.placement
            : def.placement ?? 'more',
      });
    }
  }

  // Add remaining default modules
  for (const def of defaults.modules) {
    if (!seen.has(def.id)) {
      seen.add(def.id);
      savedModules.push({ ...def });
    }
  }

  // Filter modules by actor capabilities
  const filtered = savedModules.filter((m) => {
    const meta = MODULE_REGISTRY[m.id];
    if (!meta || !meta.requiredCapability) return true;
    if (!capabilities) return false;
    return Boolean(capabilities[meta.requiredCapability]);
  });

  return { modules: filtered };
}

export function getVisibleModules(
  layout: MobileLayout,
  placement: 'home' | 'more',
  capabilities?: ActorCapabilities | null
): ModuleMeta[] {
  const resolved = resolveEffectiveLayout(layout, DEFAULT_MOBILE_LAYOUT, capabilities);
  return resolved.modules
    .filter((m) => m.enabled && m.placement === placement)
    .map((m) => MODULE_REGISTRY[m.id])
    .filter((meta): meta is ModuleMeta => Boolean(meta));
}
