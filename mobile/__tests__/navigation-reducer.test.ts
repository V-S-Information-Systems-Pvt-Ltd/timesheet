import {
  navigationReducer,
  initialNavigationState,
  type NavigationState,
} from '../src/navigation/navigation-reducer';
import type { ActorCapabilities } from '../src/api/contracts';

describe('Navigation Reducer (WP-04)', () => {
  const fullCapabilities: ActorCapabilities = {
    canViewTeam: true,
    canManageProjects: true,
    canManageActivities: true,
    canManageUsers: true,
    canManageSettings: true,
    canManageWorkspaceCustomization: true,
  };

  const restrictedCapabilities: ActorCapabilities = {
    canViewTeam: false,
    canManageProjects: false,
    canManageActivities: false,
    canManageUsers: false,
    canManageSettings: false,
    canManageWorkspaceCustomization: false,
  };

  it('switches root tabs without accumulating history stack', () => {
    let state = initialNavigationState;

    state = navigationReducer(state, {
      type: 'SWITCH_TAB',
      payload: { tab: 'timesheets', capabilities: fullCapabilities },
    });
    expect(state.activeTab).toBe('timesheets');
    expect(state.currentRoute).toBe('timesheets');
    expect(state.history).toEqual(['timesheets']);

    state = navigationReducer(state, {
      type: 'SWITCH_TAB',
      payload: { tab: 'reports', capabilities: fullCapabilities },
    });
    expect(state.activeTab).toBe('reports');
    expect(state.currentRoute).toBe('reports');
    expect(state.history).toEqual(['reports']);

    state = navigationReducer(state, {
      type: 'SWITCH_TAB',
      payload: { tab: 'dashboard', capabilities: fullCapabilities },
    });
    expect(state.activeTab).toBe('dashboard');
    expect(state.currentRoute).toBe('dashboard');
    expect(state.history).toEqual(['dashboard']);
  });

  it('pushes child routes and updates parent active tab', () => {
    let state = initialNavigationState;

    state = navigationReducer(state, {
      type: 'PUSH_ROUTE',
      payload: { route: 'leaves', capabilities: fullCapabilities },
    });
    expect(state.activeTab).toBe('more');
    expect(state.currentRoute).toBe('leaves');
    expect(state.history).toEqual(['dashboard', 'leaves']);

    state = navigationReducer(state, {
      type: 'PUSH_ROUTE',
      payload: { route: 'reminders', capabilities: fullCapabilities },
    });
    expect(state.activeTab).toBe('more');
    expect(state.currentRoute).toBe('reminders');
    expect(state.history).toEqual(['dashboard', 'leaves', 'reminders']);
  });

  it('pops child routes on GO_BACK', () => {
    let state: NavigationState = {
      activeTab: 'more',
      currentRoute: 'reminders',
      currentParams: undefined,
      history: ['dashboard', 'leaves', 'reminders'],
      stack: [{ route: 'dashboard' }, { route: 'leaves' }, { route: 'reminders' }],
      isDirty: false,
      pendingRoute: null,
      pendingParams: undefined,
      showDiscardDialog: false,
      pendingAction: null,
    };

    state = navigationReducer(state, { type: 'GO_BACK' });
    expect(state.activeTab).toBe('more');
    expect(state.currentRoute).toBe('leaves');
    expect(state.history).toEqual(['dashboard', 'leaves']);

    state = navigationReducer(state, { type: 'GO_BACK' });
    expect(state.activeTab).toBe('dashboard');
    expect(state.currentRoute).toBe('dashboard');
    expect(state.history).toEqual(['dashboard']);
  });

  it('blocks navigation to restricted routes when capabilities are insufficient', () => {
    let state = initialNavigationState;

    state = navigationReducer(state, {
      type: 'PUSH_ROUTE',
      payload: { route: 'team', capabilities: restrictedCapabilities },
    });
    expect(state.currentRoute).toBe('dashboard');
    expect(state.history).toEqual(['dashboard']);
  });

  it('allows navigation to capability-gated routes when permitted', () => {
    let state = initialNavigationState;

    state = navigationReducer(state, {
      type: 'PUSH_ROUTE',
      payload: { route: 'team', capabilities: fullCapabilities },
    });
    expect(state.currentRoute).toBe('team');
    expect(state.activeTab).toBe('more');
    expect(state.history).toEqual(['dashboard', 'team']);
  });

  it('guards dirty form changes and handles discard/cancel flow', () => {
    let state: NavigationState = {
      activeTab: 'log-time',
      currentRoute: 'log-time',
      currentParams: undefined,
      history: ['log-time'],
      stack: [{ route: 'log-time' }],
      isDirty: true,
      pendingRoute: null,
      pendingParams: undefined,
      showDiscardDialog: false,
      pendingAction: null,
    };

    // 1. Attempt switch tab -> intercepted
    state = navigationReducer(state, {
      type: 'SWITCH_TAB',
      payload: { tab: 'dashboard', capabilities: fullCapabilities },
    });
    expect(state.currentRoute).toBe('log-time');
    expect(state.pendingRoute).toBe('dashboard');
    expect(state.showDiscardDialog).toBe(true);

    // 2. Cancel discard -> stay on current screen
    state = navigationReducer(state, { type: 'CANCEL_DISCARD' });
    expect(state.currentRoute).toBe('log-time');
    expect(state.pendingRoute).toBeNull();
    expect(state.showDiscardDialog).toBe(false);
    expect(state.isDirty).toBe(true);

    // 3. Attempt push route -> intercepted
    state = navigationReducer(state, {
      type: 'PUSH_ROUTE',
      payload: { route: 'timesheets', capabilities: fullCapabilities },
    });
    expect(state.currentRoute).toBe('log-time');
    expect(state.pendingRoute).toBe('timesheets');
    expect(state.showDiscardDialog).toBe(true);

    // 4. Confirm discard -> proceeds to pending route
    state = navigationReducer(state, { type: 'CONFIRM_DISCARD' });
    expect(state.currentRoute).toBe('timesheets');
    expect(state.activeTab).toBe('timesheets');
    expect(state.isDirty).toBe(false);
    expect(state.pendingRoute).toBeNull();
    expect(state.showDiscardDialog).toBe(false);
  });

  it('sets and clears the dirty flag through SET_DIRTY', () => {
    let state = navigationReducer(initialNavigationState, {
      type: 'SET_DIRTY',
      payload: { isDirty: true },
    });
    expect(state.isDirty).toBe(true);

    state = navigationReducer(state, { type: 'SET_DIRTY', payload: { isDirty: false } });
    expect(state.isDirty).toBe(false);
  });

  /**
   * CONFIRM_DISCARD replays the transition the prompt intercepted, so for every
   * action that can raise the prompt the discarded result must equal the one the
   * same action produces on a clean form — including for routes pushed deeper
   * than a root tab, where the old stack rebuild lost frames.
   */
  it('discarding a back press keeps the frames beneath a pushed root tab', () => {
    // dashboard → push timesheets → push log-time is three deep; a rebuild from
    // `pendingRoute` used to collapse it to just timesheets.
    let state = navigationReducer(initialNavigationState, {
      type: 'PUSH_ROUTE',
      payload: { route: 'timesheets', capabilities: fullCapabilities },
    });
    state = navigationReducer(state, {
      type: 'PUSH_ROUTE',
      payload: { route: 'log-time', capabilities: fullCapabilities },
    });
    expect(state.stack.map((entry) => entry.route)).toEqual(['dashboard', 'timesheets', 'log-time']);

    const blocked = navigationReducer({ ...state, isDirty: true }, { type: 'GO_BACK' });
    expect(blocked.showDiscardDialog).toBe(true);
    expect(blocked.pendingRoute).toBe('timesheets');

    const discarded = navigationReducer(blocked, { type: 'CONFIRM_DISCARD' });
    const clean = navigationReducer({ ...state, isDirty: false }, { type: 'GO_BACK' });

    expect(discarded.stack).toEqual(clean.stack);
    expect(discarded.history).toEqual(clean.history);
    expect(discarded.currentRoute).toBe('timesheets');
    expect(discarded.activeTab).toBe(clean.activeTab);
    // The dashboard frame survives, so back from here still reaches it.
    expect(discarded.stack.map((entry) => entry.route)).toEqual(['dashboard', 'timesheets']);
  });

  it('discarding a tab switch matches a clean tab switch', () => {
    let state = navigationReducer(initialNavigationState, {
      type: 'PUSH_ROUTE',
      payload: { route: 'log-time', capabilities: fullCapabilities },
    });

    const blocked = navigationReducer({ ...state, isDirty: true }, {
      type: 'SWITCH_TAB',
      payload: { tab: 'timesheets', capabilities: fullCapabilities },
    });
    expect(blocked.pendingAction?.type).toBe('SWITCH_TAB');

    const discarded = navigationReducer(blocked, { type: 'CONFIRM_DISCARD' });
    const clean = navigationReducer(
      { ...state, isDirty: false },
      { type: 'SWITCH_TAB', payload: { tab: 'timesheets', capabilities: fullCapabilities } }
    );

    expect(discarded.stack).toEqual(clean.stack);
    expect(discarded.history).toEqual(clean.history);
    expect(discarded.currentRoute).toBe('timesheets');
  });

  it('discarding a push matches a clean push, including a re-push with new params', () => {
    const filterA = { id: 'u1', name: 'Alice', email: 'alice@vsis.lk' };
    const filterB = { id: 'u2', name: 'Bob', email: 'bob@vsis.lk' };

    let state = navigationReducer(initialNavigationState, {
      type: 'PUSH_ROUTE',
      payload: { route: 'team', capabilities: fullCapabilities },
    });
    state = navigationReducer(state, {
      type: 'PUSH_ROUTE',
      payload: { route: 'timesheets', capabilities: fullCapabilities, params: { filterUser: filterA } },
    });
    state = navigationReducer(state, {
      type: 'PUSH_ROUTE',
      payload: { route: 'log-time', capabilities: fullCapabilities },
    });

    // A push of a brand new route appends a frame...
    const blockedPush = navigationReducer({ ...state, isDirty: true }, {
      type: 'PUSH_ROUTE',
      payload: { route: 'profile', capabilities: fullCapabilities },
    });
    const discardedPush = navigationReducer(blockedPush, { type: 'CONFIRM_DISCARD' });
    const cleanPush = navigationReducer(
      { ...state, isDirty: false },
      { type: 'PUSH_ROUTE', payload: { route: 'profile', capabilities: fullCapabilities } }
    );
    expect(discardedPush.stack).toEqual(cleanPush.stack);
    expect(discardedPush.history).toEqual(cleanPush.history);

    // ...while re-pushing the current route with new params replaces its entry.
    const blockedRepush = navigationReducer({ ...state, isDirty: true }, {
      type: 'PUSH_ROUTE',
      payload: { route: 'timesheets', capabilities: fullCapabilities, params: { filterUser: filterB } },
    });
    expect(blockedRepush.pendingRoute).toBe('timesheets');
    const discardedRepush = navigationReducer(blockedRepush, { type: 'CONFIRM_DISCARD' });
    const cleanRepush = navigationReducer(
      { ...state, isDirty: false },
      {
        type: 'PUSH_ROUTE',
        payload: { route: 'timesheets', capabilities: fullCapabilities, params: { filterUser: filterB } },
      }
    );
    expect(discardedRepush.stack).toEqual(cleanRepush.stack);
    expect(discardedRepush.currentParams?.filterUser).toEqual(filterB);
  });

  it('discarding a new entry returns to the frame a clean GO_BACK would reach', () => {
    const dirtyFromDashboard: NavigationState = {
      activeTab: 'log-time',
      currentRoute: 'log-time',
      currentParams: undefined,
      history: ['dashboard', 'log-time'],
      stack: [{ route: 'dashboard' }, { route: 'log-time' }],
      isDirty: true,
      pendingRoute: null,
      pendingParams: undefined,
      showDiscardDialog: false,
      pendingAction: null,
    };

    const blocked = navigationReducer(dirtyFromDashboard, { type: 'GO_BACK' });
    expect(blocked.showDiscardDialog).toBe(true);
    expect(blocked.pendingRoute).toBe('dashboard');
    expect(blocked.currentRoute).toBe('log-time');

    const discarded = navigationReducer(blocked, { type: 'CONFIRM_DISCARD' });
    const clean = navigationReducer({ ...dirtyFromDashboard, isDirty: false }, { type: 'GO_BACK' });

    expect(discarded.stack).toEqual(clean.stack);
    expect(discarded.history).toEqual(clean.history);
    expect(discarded.currentRoute).toBe(clean.currentRoute);
    expect(discarded.activeTab).toBe(clean.activeTab);
  });

  it('discarding an edited entry preserves the filtered timesheets it came from', () => {
    const filterUser = { id: 'u1', name: 'Alice', email: 'alice@vsis.lk' };

    let state = navigationReducer(initialNavigationState, {
      type: 'SWITCH_TAB',
      payload: { tab: 'timesheets', capabilities: fullCapabilities, params: { filterUser } },
    });
    state = navigationReducer(state, {
      type: 'PUSH_ROUTE',
      payload: { route: 'edit-time', capabilities: fullCapabilities },
    });
    expect(state.history).toEqual(['timesheets', 'edit-time']);

    const blocked = navigationReducer({ ...state, isDirty: true }, { type: 'GO_BACK' });
    expect(blocked.showDiscardDialog).toBe(true);
    expect(blocked.pendingRoute).toBe('timesheets');

    const discarded = navigationReducer(blocked, { type: 'CONFIRM_DISCARD' });
    const clean = navigationReducer({ ...state, isDirty: false }, { type: 'GO_BACK' });

    expect(discarded.stack).toEqual(clean.stack);
    expect(discarded.currentRoute).toBe('timesheets');
    expect(discarded.currentParams?.filterUser).toEqual(filterUser);
  });

  it('resets to initial state on RESET action', () => {
    let state: NavigationState = {
      activeTab: 'more',
      currentRoute: 'reminders',
      currentParams: undefined,
      history: ['dashboard', 'reminders'],
      stack: [{ route: 'dashboard' }, { route: 'reminders' }],
      isDirty: true,
      pendingRoute: 'dashboard',
      pendingParams: undefined,
      showDiscardDialog: true,
      pendingAction: { type: 'GO_BACK' },
    };

    state = navigationReducer(state, { type: 'RESET' });
    expect(state).toEqual(initialNavigationState);
  });

  it('preserves route params on PUSH_ROUTE and restores previous params on GO_BACK', () => {
    let state = initialNavigationState;

    state = navigationReducer(state, {
      type: 'PUSH_ROUTE',
      payload: {
        route: 'reports',
        capabilities: fullCapabilities,
        params: { filterUser: { id: 'u1', name: 'Alice', email: 'alice@vsis.lk' } },
      },
    });

    expect(state.currentRoute).toBe('reports');
    expect(state.currentParams?.filterUser).toEqual({ id: 'u1', name: 'Alice', email: 'alice@vsis.lk' });
    expect(state.stack).toHaveLength(2);
    expect(state.stack[1].params?.filterUser?.id).toBe('u1');

    // Push another route
    state = navigationReducer(state, {
      type: 'PUSH_ROUTE',
      payload: { route: 'leaves', capabilities: fullCapabilities },
    });
    expect(state.currentRoute).toBe('leaves');
    expect(state.currentParams).toBeUndefined();

    // Pop back to reports -> should restore Alice filter params
    state = navigationReducer(state, { type: 'GO_BACK' });
    expect(state.currentRoute).toBe('reports');
    expect(state.currentParams?.filterUser).toEqual({ id: 'u1', name: 'Alice', email: 'alice@vsis.lk' });

    // Clear params action
    state = navigationReducer(state, { type: 'CLEAR_PARAMS' });
    expect(state.currentParams).toBeUndefined();
    expect(state.stack[state.stack.length - 1].params).toBeUndefined();
  });

  it('keeps member filters scoped to their own route entry', () => {
    let state = navigationReducer(initialNavigationState, {
      type: 'PUSH_ROUTE',
      payload: {
        route: 'reports',
        capabilities: fullCapabilities,
        params: { filterUser: { id: 'member-a', name: 'Member A' } },
      },
    });

    state = navigationReducer(state, { type: 'CLEAR_PARAMS' });
    state = navigationReducer(state, {
      type: 'SWITCH_TAB',
      payload: { tab: 'timesheets', capabilities: fullCapabilities },
    });

    expect(state.currentRoute).toBe('timesheets');
    expect(state.currentParams).toBeUndefined();
    expect(state.stack.at(-1)?.params).toBeUndefined();
  });
  it('GO_BACK on a non-dashboard root tab is a no-op, not a reset to dashboard', () => {
    let state = initialNavigationState;
    state = navigationReducer(state, {
      type: 'SWITCH_TAB',
      payload: { tab: 'more', capabilities: fullCapabilities },
    });
    expect(state.currentRoute).toBe('more');

    const after = navigationReducer(state, { type: 'GO_BACK' });
    expect(after.currentRoute).toBe('more');
    expect(after).toBe(state);
  });
});
