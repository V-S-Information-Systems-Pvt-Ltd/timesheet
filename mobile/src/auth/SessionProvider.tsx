import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';

import type { ApiClient } from '../api/client';
import type { SessionController, SessionState } from './session-controller';

export interface SessionContextValue {
  state: SessionState;
  controller: SessionController;
  /** API client bound to the approved server base URL. */
  client: ApiClient;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  controller: SessionController;
  client: ApiClient;
  /** Set false when the host screen drives boot itself. */
  autoRestore?: boolean;
  children: ReactNode;
}

/**
 * Bridges the imperative {@link SessionController} into React and boots the
 * cold-start restore exactly once.
 */
export function SessionProvider({ controller, client, autoRestore = true, children }: SessionProviderProps) {
  const state = useSyncExternalStore(
    (onChange) => controller.subscribe(onChange),
    () => controller.getState(),
    () => controller.getState(),
  );
  const restoreStarted = useRef(false);

  useEffect(() => {
    if (!autoRestore || restoreStarted.current) return;
    if (state.status !== 'booting') return;
    restoreStarted.current = true;
    void controller.restore();
  }, [autoRestore, controller, state.status]);

  const value = useMemo<SessionContextValue>(() => ({ state, controller, client }), [state, controller, client]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>.');
  return value;
}
