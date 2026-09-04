import { RecentWorkStore, MAX_RECENT_WORK_ENTRIES } from '../src/storage/recent-work-store';

describe('RecentWorkStore', () => {
  let store: RecentWorkStore;

  beforeEach(() => {
    store = new RecentWorkStore();
  });

  it('adds unique entries and respects max capacity', () => {
    const origin = 'https://timesheet.example.com';
    const user = 'user-1';

    for (let i = 1; i <= 15; i++) {
      store.add(origin, user, `Task ${i}`);
    }

    const list = store.get(origin, user);
    expect(list).toHaveLength(MAX_RECENT_WORK_ENTRIES);
    expect(list[0]).toBe('Task 15'); // newest first
  });

  it('deduplicates case-insensitively and floats newest to top', () => {
    const origin = 'https://timesheet.example.com';
    const user = 'user-1';

    store.add(origin, user, 'Code review');
    store.add(origin, user, 'Sprint planning');
    store.add(origin, user, 'CODE REVIEW');

    const list = store.get(origin, user);
    expect(list).toEqual(['CODE REVIEW', 'Sprint planning']);
  });

  it('strictly isolates entries across users and server origins', () => {
    const s1 = 'https://server-a.com';
    const s2 = 'https://server-b.com';
    const u1 = 'user-1';
    const u2 = 'user-2';

    store.add(s1, u1, 'Server A User 1 task');
    store.add(s1, u2, 'Server A User 2 task');
    store.add(s2, u1, 'Server B User 1 task');

    expect(store.get(s1, u1)).toEqual(['Server A User 1 task']);
    expect(store.get(s1, u2)).toEqual(['Server A User 2 task']);
    expect(store.get(s2, u1)).toEqual(['Server B User 1 task']);
    expect(store.get(s2, u2)).toEqual([]);
  });

  it('clears specific user/server entries or all entries', () => {
    const s1 = 'https://server-a.com';
    const u1 = 'user-1';
    const u2 = 'user-2';

    store.add(s1, u1, 'Task 1');
    store.add(s1, u2, 'Task 2');

    store.clear(s1, u1);
    expect(store.get(s1, u1)).toEqual([]);
    expect(store.get(s1, u2)).toEqual(['Task 2']);

    store.clear();
    expect(store.get(s1, u2)).toEqual([]);
  });
});
