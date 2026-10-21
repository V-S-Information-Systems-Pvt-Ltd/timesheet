import { useEffect, useState } from 'react';
import { backfillMinDate } from '@vsis/core';
import { useSessionActions } from '../auth/SessionProvider';

/**
 * Earliest date the user may log, from the user-readable backfill window.
 * `undefined` until loaded or if loading fails: callers then do not block and
 * the server stays the enforcer.
 */
export function useBackfillMinDate(today: string): string | undefined {
  const { getBackfillWindow } = useSessionActions();
  const [min, setMin] = useState<string | undefined>();

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const settings = await getBackfillWindow();
        if (live && settings && typeof settings === 'object') setMin(backfillMinDate(today, settings));
      } catch {
        if (live) setMin(undefined);
      }
    })();
    return () => {
      live = false;
    };
  }, [getBackfillWindow, today]);

  return min;
}
