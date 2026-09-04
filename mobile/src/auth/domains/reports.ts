import React from 'react';
import type { ApiClient } from '../../api/client';
import type { SessionController } from '../session-controller';
import {
  exportWithRetry,
  reportFileExporter,
  type ReportExportOutcome,
} from '../../services/reportFileExport';
import type {
  ChangePasswordInput,
  MobileActor,
  PersonProfile,
  ReportParams,
  ReportTotals,
  UpdateProfileInput,
} from '../../api/contracts';
import type { WithAuth } from './types';

export interface ReportsDomainCallbacks {
  client: ApiClient | null;
  controller: SessionController | null;
  getValidToken: () => Promise<string>;
  setAccessToken: (token: string) => void;
  setActor: React.Dispatch<React.SetStateAction<MobileActor | null>>;
}

export function createReportsActions(
  withAuth: WithAuth,
  callbacks: ReportsDomainCallbacks
) {
  const { client, controller, getValidToken, setAccessToken, setActor } = callbacks;

  return {
    getReports: async (params?: ReportParams): Promise<ReportTotals> => {
      return withAuth((c, token) => c.getReports(token, params), {
        defaultValue: { totalHours: 0, totalEntries: 0, byGroup: [] },
      });
    },

    exportReportsFile: async (
      params?: ReportParams,
      options?: { signal?: AbortSignal }
    ): Promise<ReportExportOutcome> => {
      if (!client || !controller) {
        return { kind: 'failed', retryable: false, reason: 'signed-out' };
      }
      const searchParams = new URLSearchParams();
      if (params?.project) searchParams.set('project', params.project);
      if (params?.user || params?.userId) searchParams.set('user', (params.user || params.userId)!);
      if (params?.from) searchParams.set('from', params.from);
      if (params?.to) searchParams.set('to', params.to);
      const query = searchParams.toString();
      const url = `${client.baseUrl}/api/v1/reports/export${query ? `?${query}` : ''}`;
      try {
        const token = await getValidToken();
        return await exportWithRetry(
          reportFileExporter,
          {
            url,
            accessToken: token,
            suggestedFilename: 'timesheets_report.csv',
            signal: options?.signal ?? null,
          },
          async () => {
            const nextToken = await controller.refreshAccessToken();
            setAccessToken(nextToken);
            return nextToken;
          }
        );
      } catch {
        if (options?.signal?.aborted) return { kind: 'cancelled' };
        return { kind: 'failed', retryable: false, reason: 'token-unavailable' };
      }
    },

    listPeople: async (): Promise<PersonProfile[]> => {
      return withAuth((c, token) => c.listPeople(token), { defaultValue: [] });
    },

    changePassword: async (input: ChangePasswordInput): Promise<void> => {
      await withAuth((c, token) => c.changePassword(token, input), {
        errorMessage: 'You must be signed in to change password.',
      });
    },

    updateProfile: async (input: UpdateProfileInput): Promise<MobileActor> => {
      const updated = await withAuth((c, token) => c.updateProfile(token, input), {
        errorMessage: 'You must be signed in to update profile.',
      });
      setActor(updated);
      return updated;
    },
  };
}
