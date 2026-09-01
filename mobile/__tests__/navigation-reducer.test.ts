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
  };

  const restrictedCapabilities: ActorCapabilities = {
    canViewTeam: false,
    canManageProjects: false,
    canManageActivities: false,
    canManageUsers: false,
    canManageSettings: false,
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
      history: ['dashboard', 'leaves', 'reminders'],
      isDirty: false,
      pendingRoute: null,
      showDiscardDialog: false,
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
      history: ['log-time'],
      isDirty: true,
      pendingRoute: null,
      showDiscardDialog: false,
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

  it('resets to initial state on RESET action', () => {
    let state: NavigationState = {
      activeTab: 'more',
      currentRoute: 'reminders',
      history: ['dashboard', 'reminders'],
      isDirty: true,
      pendingRoute: 'dashboard',
      showDiscardDialog: true,
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
});
