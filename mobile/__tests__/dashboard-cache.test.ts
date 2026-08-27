import { DashboardCache } from '../src/storage/dashboard-cache';
import type { MobileDashboardData } from '../src/api/contracts';

const fakeDashboard: MobileDashboardData = {
  actor: {
    id: 'user-1',
    email: 'user1@example.com',
    role: 'user',
    permissionRole: 'user',
    hierarchyRole: 'user',
    isActive: true,
  },
  today: { date: '2026-08-27', hours: 4 },
  week: { from: '2026-08-21', to: '2026-08-27', hours: 24 },
  recentEntries: [],
  quickActions: ['create-timesheet'],
};

describe('DashboardCache', () => {
  it('isolates cached data by server origin and actor id', () => {
    const cache = new DashboardCache();

    cache.set('https://server-a.example.com', 'user-1', fakeDashboard);

    // Matches same server and user
    expect(cache.get('https://server-a.example.com', 'user-1')).toEqual(fakeDashboard);
    expect(cache.get('https://server-a.example.com/', 'user-1')).toEqual(fakeDashboard);

    // Different user on same server -> null
    expect(cache.get('https://server-a.example.com', 'user-2')).toBeNull();

    // Different server for same user -> null
    expect(cache.get('https://server-b.example.com', 'user-1')).toBeNull();
  });

  it('expires cached data when TTL has elapsed', () => {
    const cache = new DashboardCache();
    cache.set('https://server-a.example.com', 'user-1', fakeDashboard);

    // Immediate get succeeds
    expect(cache.get('https://server-a.example.com', 'user-1', 1000)).toEqual(fakeDashboard);

    // Query with 0 maxAge (expired) returns null and clears entry
    expect(cache.get('https://server-a.example.com', 'user-1', -1)).toBeNull();
    expect(cache.get('https://server-a.example.com', 'user-1')).toBeNull();
  });

  it('clears specific origin/user cache without clearing others', () => {
    const cache = new DashboardCache();
    cache.set('https://server-a.example.com', 'user-1', fakeDashboard);
    cache.set('https://server-a.example.com', 'user-2', fakeDashboard);

    cache.clear('https://server-a.example.com', 'user-1');

    expect(cache.get('https://server-a.example.com', 'user-1')).toBeNull();
    expect(cache.get('https://server-a.example.com', 'user-2')).toEqual(fakeDashboard);

    cache.clear();
    expect(cache.get('https://server-a.example.com', 'user-2')).toBeNull();
  });
});
