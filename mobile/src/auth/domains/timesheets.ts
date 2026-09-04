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
}

export function createTimesheetsActions(
  withAuth: WithAuth,
  callbacks: TimesheetsDomainCallbacks
) {
  const { loadDashboard, setDashboard } = callbacks;

  return {
    listTimesheets: async (params?: TimesheetListParams): Promise<TimesheetListResult> => {
      return withAuth((c, token) => c.listTimesheets(token, params), {
        defaultValue: { rows: [] },
      });
    },

    createTimesheet: async (input: CreateTimesheetInput): Promise<void> => {
      await withAuth((c, token) => c.createTimesheet(token, input), {
        errorMessage: 'You must be signed in to log time.',
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
      const res = await withAuth((c, token) => c.duplicateTimesheet(token, id, targetDate), {
        errorMessage: 'You must be signed in to duplicate time.',
      });
      await loadDashboard();
      return res.entry;
    },

    duplicateTimesheets: async (
      items: BatchDuplicateItem[]
    ): Promise<BatchDuplicateTimesheetsResponse> => {
      if (items.length === 0) {
        return { results: [], duplicatedCount: 0 };
      }
      try {
        const res = await withAuth((c, token) => c.duplicateTimesheets(token, items), {
          errorMessage: 'You must be signed in to duplicate time.',
        });
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
      try {
        await withAuth((c, token) => c.deleteTimesheet(token, id), {
          errorMessage: 'You must be signed in to delete time.',
        });
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
      try {
        const res = await withAuth((c, token) => c.deleteTimesheets(token, ids), {
          errorMessage: 'You must be signed in to delete time.',
        });
        await loadDashboard();
        return res;
      } catch (err) {
        await loadDashboard();
        throw err;
      }
    },
  };
}
