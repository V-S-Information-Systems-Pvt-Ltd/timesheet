import {
  type AppRoute,
  type RootTab,
  ROUTE_REGISTRY,
  ROOT_TABS,
  canAccessRoute,
} from './routes';
import type { ActorCapabilities } from '../api/contracts';

export interface FilterUserParam {
  id: string;
  name?: string | null;
  email?: string;
}

export interface RouteParams {
  filterUser?: FilterUserParam | null;
}

export interface NavigationStackEntry {
  route: AppRoute;
  params?: RouteParams;
}

export interface NavigationState {
  activeTab: RootTab;
  currentRoute: AppRoute;
  currentParams?: RouteParams;
  history: AppRoute[];
  stack: NavigationStackEntry[];
  isDirty: boolean;
  pendingRoute: AppRoute | null;
  pendingParams?: RouteParams;
  showDiscardDialog: boolean;
}

export type NavigationAction =
  | { type: 'SWITCH_TAB'; payload: { tab: RootTab; capabilities?: ActorCapabilities | null; params?: RouteParams } }
  | { type: 'PUSH_ROUTE'; payload: { route: AppRoute; capabilities?: ActorCapabilities | null; params?: RouteParams } }
  | { type: 'CLEAR_PARAMS' }
  | { type: 'GO_BACK' }
  | { type: 'SET_DIRTY'; payload: { isDirty: boolean } }
  | { type: 'CONFIRM_DISCARD' }
  | { type: 'CANCEL_DISCARD' }
  | { type: 'RESET' };

export const initialNavigationState: NavigationState = {
  activeTab: 'dashboard',
  currentRoute: 'dashboard',
  currentParams: undefined,
  history: ['dashboard'],
  stack: [{ route: 'dashboard' }],
  isDirty: false,
  pendingRoute: null,
  pendingParams: undefined,
  showDiscardDialog: false,
};

export function navigationReducer(
  state: NavigationState,
  action: NavigationAction
): NavigationState {
  switch (action.type) {
    case 'SWITCH_TAB': {
      const { tab, capabilities, params } = action.payload;
      if (!canAccessRoute(tab, capabilities)) {
        return state;
      }

      if (state.isDirty && (state.currentRoute !== tab || params !== state.currentParams)) {
        return {
          ...state,
          pendingRoute: tab,
          pendingParams: params,
          showDiscardDialog: true,
        };
      }

      return {
        ...state,
        activeTab: tab,
        currentRoute: tab,
        currentParams: params,
        history: [tab],
        stack: [{ route: tab, params }],
        isDirty: false,
        pendingRoute: null,
        pendingParams: undefined,
        showDiscardDialog: false,
      };
    }

    case 'PUSH_ROUTE': {
      const { route, capabilities, params } = action.payload;
      if (!canAccessRoute(route, capabilities)) {
        return state;
      }

      if (state.isDirty && (state.currentRoute !== route || params !== state.currentParams)) {
        return {
          ...state,
          pendingRoute: route,
          pendingParams: params,
          showDiscardDialog: true,
        };
      }

      const meta = ROUTE_REGISTRY[route];
      const nextTab = meta.isRootTab ? (route as RootTab) : meta.parentTab;

      // If pushing the already active route with identical params, do nothing
      if (state.currentRoute === route && JSON.stringify(state.currentParams) === JSON.stringify(params)) {
        return state;
      }

      // If pushing same route with updated params, update top stack entry
      if (state.currentRoute === route) {
        const currentStack = state.stack ?? state.history.map((r) => ({ route: r }));
        const nextStack = [...currentStack];
        nextStack[nextStack.length - 1] = { route, params };
        return {
          ...state,
          currentParams: params,
          stack: nextStack,
          isDirty: false,
          pendingRoute: null,
          pendingParams: undefined,
          showDiscardDialog: false,
        };
      }

      const currentStack = state.stack ?? state.history.map((r) => ({ route: r }));
      const nextEntry: NavigationStackEntry = { route, params };

      return {
        ...state,
        activeTab: nextTab,
        currentRoute: route,
        currentParams: params,
        history: [...state.history, route],
        stack: [...currentStack, nextEntry],
        isDirty: false,
        pendingRoute: null,
        pendingParams: undefined,
        showDiscardDialog: false,
      };
    }

    case 'CLEAR_PARAMS': {
      const currentStack = state.stack ?? state.history.map((r) => ({ route: r }));
      const nextStack = [...currentStack];
      if (nextStack.length > 0) {
        nextStack[nextStack.length - 1] = { ...nextStack[nextStack.length - 1], params: undefined };
      }
      return {
        ...state,
        currentParams: undefined,
        stack: nextStack,
      };
    }

    case 'GO_BACK': {
      const currentStack = state.stack ?? state.history.map((r) => ({ route: r }));
      if (currentStack.length <= 1) {
        if (state.currentRoute === 'dashboard') {
          return state;
        }
        if (state.isDirty) {
          return {
            ...state,
            pendingRoute: 'dashboard',
            pendingParams: undefined,
            showDiscardDialog: true,
          };
        }
        return {
          ...state,
          activeTab: 'dashboard',
          currentRoute: 'dashboard',
          currentParams: undefined,
          history: ['dashboard'],
          stack: [{ route: 'dashboard' }],
          isDirty: false,
          pendingRoute: null,
          pendingParams: undefined,
          showDiscardDialog: false,
        };
      }

      const prevEntry = currentStack[currentStack.length - 2];
      if (state.isDirty) {
        return {
          ...state,
          pendingRoute: prevEntry.route,
          pendingParams: prevEntry.params,
          showDiscardDialog: true,
        };
      }

      const nextStack = currentStack.slice(0, -1);
      const nextHistory = state.history.slice(0, -1);
      const top = nextStack[nextStack.length - 1];
      const meta = ROUTE_REGISTRY[top.route];
      const nextTab = meta.isRootTab ? (top.route as RootTab) : meta.parentTab;

      return {
        ...state,
        activeTab: nextTab,
        currentRoute: top.route,
        currentParams: top.params,
        history: nextHistory,
        stack: nextStack,
        isDirty: false,
        pendingRoute: null,
        pendingParams: undefined,
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
      const destParams = state.pendingParams;
      const meta = ROUTE_REGISTRY[destination];
      const nextTab = meta.isRootTab ? (destination as RootTab) : meta.parentTab;
      const isRoot = ROOT_TABS.includes(destination as RootTab);

      return {
        ...state,
        activeTab: nextTab,
        currentRoute: destination,
        currentParams: destParams,
        history: isRoot ? [destination] : ['dashboard', destination],
        stack: isRoot
          ? [{ route: destination, params: destParams }]
          : [{ route: 'dashboard' }, { route: destination, params: destParams }],
        isDirty: false,
        pendingRoute: null,
        pendingParams: undefined,
        showDiscardDialog: false,
      };
    }

    case 'CANCEL_DISCARD': {
      return {
        ...state,
        pendingRoute: null,
        pendingParams: undefined,
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

