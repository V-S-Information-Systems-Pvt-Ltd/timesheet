import {
  type AppRoute,
  type RootTab,
  ROUTE_REGISTRY,
  ROOT_TABS,
  canAccessRoute,
} from './routes';
import type { ActorCapabilities } from '../api/contracts';

export interface NavigationState {
  activeTab: RootTab;
  currentRoute: AppRoute;
  history: AppRoute[];
  isDirty: boolean;
  pendingRoute: AppRoute | null;
  showDiscardDialog: boolean;
}

export type NavigationAction =
  | { type: 'SWITCH_TAB'; payload: { tab: RootTab; capabilities?: ActorCapabilities | null } }
  | { type: 'PUSH_ROUTE'; payload: { route: AppRoute; capabilities?: ActorCapabilities | null } }
  | { type: 'GO_BACK' }
  | { type: 'SET_DIRTY'; payload: { isDirty: boolean } }
  | { type: 'CONFIRM_DISCARD' }
  | { type: 'CANCEL_DISCARD' }
  | { type: 'RESET' };

export const initialNavigationState: NavigationState = {
  activeTab: 'dashboard',
  currentRoute: 'dashboard',
  history: ['dashboard'],
  isDirty: false,
  pendingRoute: null,
  showDiscardDialog: false,
};

export function navigationReducer(
  state: NavigationState,
  action: NavigationAction
): NavigationState {
  switch (action.type) {
    case 'SWITCH_TAB': {
      const { tab, capabilities } = action.payload;
      if (!canAccessRoute(tab, capabilities)) {
        return state;
      }

      if (state.isDirty && state.currentRoute !== tab) {
        return {
          ...state,
          pendingRoute: tab,
          showDiscardDialog: true,
        };
      }

      return {
        ...state,
        activeTab: tab,
        currentRoute: tab,
        history: [tab],
        isDirty: false,
        pendingRoute: null,
        showDiscardDialog: false,
      };
    }

    case 'PUSH_ROUTE': {
      const { route, capabilities } = action.payload;
      if (!canAccessRoute(route, capabilities)) {
        return state;
      }

      if (state.isDirty && state.currentRoute !== route) {
        return {
          ...state,
          pendingRoute: route,
          showDiscardDialog: true,
        };
      }

      const meta = ROUTE_REGISTRY[route];
      const nextTab = meta.isRootTab ? (route as RootTab) : meta.parentTab;

      // If pushing the already active route, do nothing
      if (state.currentRoute === route) {
        return state;
      }

      return {
        ...state,
        activeTab: nextTab,
        currentRoute: route,
        history: [...state.history, route],
        isDirty: false,
        pendingRoute: null,
        showDiscardDialog: false,
      };
    }

    case 'GO_BACK': {
      if (state.history.length <= 1) {
        if (state.currentRoute === 'dashboard') {
          return state;
        }
        if (state.isDirty) {
          return {
            ...state,
            pendingRoute: 'dashboard',
            showDiscardDialog: true,
          };
        }
        return {
          ...state,
          activeTab: 'dashboard',
          currentRoute: 'dashboard',
          history: ['dashboard'],
          isDirty: false,
          pendingRoute: null,
          showDiscardDialog: false,
        };
      }

      const prevRoute = state.history[state.history.length - 2];
      if (state.isDirty) {
        return {
          ...state,
          pendingRoute: prevRoute,
          showDiscardDialog: true,
        };
      }

      const nextHistory = state.history.slice(0, -1);
      const nextRoute = nextHistory[nextHistory.length - 1];
      const meta = ROUTE_REGISTRY[nextRoute];
      const nextTab = meta.isRootTab ? (nextRoute as RootTab) : meta.parentTab;

      return {
        ...state,
        activeTab: nextTab,
        currentRoute: nextRoute,
        history: nextHistory,
        isDirty: false,
        pendingRoute: null,
        showDiscardDialog: false,
      };
    }

    case 'SET_DIRTY': {
      return {
        ...state,
        isDirty: action.payload.isDirty,
      };
    }

    case 'CONFIRM_DISCARD': {
      const destination = state.pendingRoute ?? 'dashboard';
      const meta = ROUTE_REGISTRY[destination];
      const nextTab = meta.isRootTab ? (destination as RootTab) : meta.parentTab;
      const isRoot = ROOT_TABS.includes(destination as RootTab);

      return {
        ...state,
        activeTab: nextTab,
        currentRoute: destination,
        history: isRoot ? [destination] : ['dashboard', destination],
        isDirty: false,
        pendingRoute: null,
        showDiscardDialog: false,
      };
    }

    case 'CANCEL_DISCARD': {
      return {
        ...state,
        pendingRoute: null,
        showDiscardDialog: false,
      };
    }

    case 'RESET': {
      return { ...initialNavigationState };
    }

    default:
      return state;
  }
}
