import {
  MODULE_REGISTRY,
  ESSENTIAL_MODULE_IDS,
  DEFAULT_MOBILE_LAYOUT,
  resolveEffectiveLayout,
  getVisibleModules,
} from '../src/navigation/modules';
import type { MobileLayout } from '../src/api/contracts';

describe('mobile navigation modules', () => {
  it('defines metadata for all registered modules', () => {
    expect(MODULE_REGISTRY['log-time']).toBeDefined();
    expect(MODULE_REGISTRY.timesheets).toBeDefined();
    expect(MODULE_REGISTRY.reports).toBeDefined();
    expect(MODULE_REGISTRY.leaves).toBeDefined();
    expect(MODULE_REGISTRY.reminders).toBeDefined();
    expect(MODULE_REGISTRY.team).toBeDefined();
    expect(MODULE_REGISTRY.profile).toBeDefined();
  });

  it('preserves essential status for log-time, timesheets, and profile', () => {
    expect(ESSENTIAL_MODULE_IDS).toContain('log-time');
    expect(ESSENTIAL_MODULE_IDS).toContain('timesheets');
    expect(ESSENTIAL_MODULE_IDS).toContain('profile');

    const saved: MobileLayout = {
      modules: [
        { id: 'log-time', enabled: false, placement: 'home' },
        { id: 'timesheets', enabled: false, placement: 'home' },
        { id: 'profile', enabled: false, placement: 'more' },
      ],
    };

    const resolved = resolveEffectiveLayout(saved);
    const logTime = resolved.modules.find((m) => m.id === 'log-time');
    const timesheets = resolved.modules.find((m) => m.id === 'timesheets');
    const profile = resolved.modules.find((m) => m.id === 'profile');

    expect(logTime?.enabled).toBe(true);
    expect(timesheets?.enabled).toBe(true);
    expect(profile?.enabled).toBe(true);
  });

  it('filters out modules actor lacks capabilities for', () => {
    const unprivileged = {
      canViewTeam: false,
      canManageProjects: false,
      canManageActivities: false,
      canManageUsers: false,
      canManageSettings: false,
    };
    const visibleHome = getVisibleModules(DEFAULT_MOBILE_LAYOUT, 'home', unprivileged);
    const visibleMore = getVisibleModules(DEFAULT_MOBILE_LAYOUT, 'more', unprivileged);

    const allIds = [...visibleHome, ...visibleMore].map((m) => m.id);
    expect(allIds).not.toContain('team');
    expect(allIds).not.toContain('admin-projects');
    expect(allIds).not.toContain('admin-activities');
    expect(allIds).not.toContain('admin-users');
    expect(allIds).not.toContain('admin-settings');
  });

  it('includes team and admin modules when actor holds capabilities', () => {
    const privileged = {
      canViewTeam: true,
      canManageProjects: true,
      canManageActivities: true,
      canManageUsers: true,
      canManageSettings: true,
    };
    const visibleMore = getVisibleModules(DEFAULT_MOBILE_LAYOUT, 'more', privileged);
    const moreIds = visibleMore.map((m) => m.id);

    expect(moreIds).toContain('team');
    expect(moreIds).toContain('admin-projects');
    expect(moreIds).toContain('admin-activities');
    expect(moreIds).toContain('admin-users');
    expect(moreIds).toContain('admin-settings');
  });
});
