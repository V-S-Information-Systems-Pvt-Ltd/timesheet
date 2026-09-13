import React from 'react';
import type {
  CreateTimesheetInput,
  TimesheetListParams,
  TimesheetListResult,
  TimesheetEntry,
  BatchDuplicateItem,
  BatchDuplicateTimesheetsResponse,
  BatchDeleteTimesheetsResponse,
  MobileDashboardData,
} from '../../api/contracts';
import type { WithAuth } from './types';

export interface TimesheetsDomainCallbacks {
  loadDashboard: () => Promise<MobileDashboardData | null>;
  setDashboard: React.Dispatch<React.SetStateAction<MobileDashboardData | null>>;
  enqueueCreateTimesheet: (
    input: CreateTimesheetInput,
    idempotencyKey: string
  ) => Promise<{ success: boolean }>;
}

function generateIdempotencyKey(prefix = 'req'): string {
  const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof cryptoObj?.randomUUID === 'function'
    ? cryptoObj.randomUUID()
    : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createTimesheetsActions(
  withAuth: WithAuth,
  callbacks: TimesheetsDomainCallbacks
) {
  const { loadDashboard, setDashboard, enqueueCreateTimesheet } = callbacks;

  return {
    listTimesheets: async (params?: TimesheetListParams): Promise<TimesheetListResult> => {
      // A failed, unauthorised or offline read must not be reported as a
      // successful empty page: the list screen renders its empty state from a
      // genuinely empty result, so swallowing the error here produced a
      // misleading "No timesheet entries found." for a list that still had
      // entries. Let failures reach the caller so it can offer a retry.
      return withAuth((c, token) => c.listTimesheets(token, params), {
        errorMessage: 'Could not load timesheets. Check your connection and try again.',
      });
    },

    createTimesheet: async (input: CreateTimesheetInput): Promise<void> => {
      // The queue must reuse this key after an unknown network outcome. That
      // lets the server atomically return the original write rather than create
      // a duplicate if it completed just before the connection was lost.
      const idempotencyKey = generateIdempotencyKey('create');
      await withAuth((c, token) => c.createTimesheet(token, input, { idempotencyKey }), {
        errorMessage: 'You must be signed in to log time.',
        onNetworkFailure: () => enqueueCreateTimesheet(input, idempotencyKey),
      });
      await loadDashboard();
    },

    updateTimesheet: async (id: string, input: CreateTimesheetInput): Promise<void> => {
      await withAuth((c, token) => c.updateTimesheet(token, id, input), {
        errorMessage: 'You must be signed in to edit time.',
      });
      await loadDashboard();
    },

    duplicateTimesheet: async (id: string, targetDate?: string): Promise<TimesheetEntry> => {
      // Generate one idempotency key per invocation covering automatic retries (401 single-flight);
      // deliberate re-taps generate a fresh key and remain new duplicate actions.
      const idempotencyKey = generateIdempotencyKey('dup');
      const res = await withAuth(
        (c, token) => c.duplicateTimesheet(token, id, targetDate, { idempotencyKey }),
        {
          errorMessage: 'You must be signed in to duplicate time.',
        }
      );
      await loadDashboard();
      return res.entry;
    },

    duplicateTimesheets: async (
      items: BatchDuplicateItem[]
    ): Promise<BatchDuplicateTimesheetsResponse> => {
      if (items.length === 0) {
        return { results: [], duplicatedCount: 0 };
      }
      const idempotencyKey = generateIdempotencyKey('bdup');
      try {
        const res = await withAuth(
          (c, token) => c.duplicateTimesheets(token, items, { idempotencyKey }),
          {
            errorMessage: 'You must be signed in to duplicate time.',
          }
        );
        await loadDashboard();
        return res;
      } catch (err) {
        await loadDashboard();
        throw err;
      }
    },

    deleteTimesheet: async (id: string): Promise<void> => {
      setDashboard((prev) =>
        prev
          ? {
              ...prev,
              recentEntries: prev.recentEntries.filter((e) => e.id !== id),
            }
          : null
      );
      const idempotencyKey = generateIdempotencyKey('del');
      try {
        await withAuth(
          (c, token) => c.deleteTimesheet(token, id, { idempotencyKey }),
          {
            errorMessage: 'You must be signed in to delete time.',
          }
        );
        await loadDashboard();
      } catch (err) {
        await loadDashboard();
        throw err;
      }
    },

    deleteTimesheets: async (ids: string[]): Promise<BatchDeleteTimesheetsResponse> => {
      if (ids.length === 0) {
        return { results: [], deletedCount: 0 };
      }
      const idSet = new Set(ids);
      setDashboard((prev) =>
        prev
          ? {
              ...prev,
              recentEntries: prev.recentEntries.filter((e) => !idSet.has(e.id)),
            }
          : null
      );
      const idempotencyKey = generateIdempotencyKey('bdel');
      try {
        const res = await withAuth(
          (c, token) => c.deleteTimesheets(token, ids, { idempotencyKey }),
          {
            errorMessage: 'You must be signed in to delete time.',
          }
        );
        await loadDashboard();
        return res;
      } catch (err) {
        await loadDashboard();
        throw err;
      }
    },
  };
}
