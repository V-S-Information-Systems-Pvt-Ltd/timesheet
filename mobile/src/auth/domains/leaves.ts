import type {
  CreateLeaveInput,
  CreateAdminLeaveInput,
  LeaveRow,
  MobileDashboardData,
} from '../../api/contracts';
import type { QueuedOfflineMutation } from '../../storage/offline-queue';
import { createFreshMutation } from './fresh-create';
import type { WithAuth } from './types';

export interface LeavesDomainCallbacks {
  loadDashboard: () => Promise<MobileDashboardData | null>;
  enqueueFreshCreate: (input: CreateLeaveInput) => Promise<QueuedOfflineMutation>;
  completeFreshCreate: (mutationId: string) => Promise<void>;
  markFreshCreateForReview: (mutationId: string, message: string) => Promise<void>;
}

export function createLeavesActions(
  withAuth: WithAuth,
  callbacks: LeavesDomainCallbacks
) {
  const { loadDashboard } = callbacks;

  return {
    listLeaves: async (params?: { from?: string; to?: string }): Promise<LeaveRow[]> => {
      return withAuth((c, token) => c.listLeaves(token, params), {
        defaultValue: [],
      });
    },

    createLeave: async (input: CreateLeaveInput): Promise<void> => {
      if (input.userId) {
        await withAuth((c, token) => c.createLeave(token, input), {
          errorMessage: 'You must be signed in to submit leaves.',
        });
        return;
      }

      await createFreshMutation(
        withAuth,
        input,
        (client, token, value, idempotencyKey) =>
          client.createLeave(token, value, { idempotencyKey }),
        callbacks,
        'You must be signed in to submit leaves.'
      );
    },

    deleteLeave: async (id: string): Promise<void> => {
      await withAuth((c, token) => c.deleteLeave(token, id), {
        errorMessage: 'You must be signed in to delete leaves.',
      });
    },

    listAdminLeaves: async (params?: {
      userId?: string;
      from?: string;
      to?: string;
    }): Promise<LeaveRow[]> => {
      return withAuth((c, token) => c.listAdminLeaves(params, token), {
        defaultValue: [],
      });
    },

    createAdminLeave: async (input: CreateAdminLeaveInput): Promise<void> => {
      await withAuth((c, token) => c.createAdminLeave(input, token), {
        errorMessage: 'You must be signed in to create leave markers.',
      });
      await loadDashboard();
    },

    deleteAdminLeave: async (id: string): Promise<void> => {
      await withAuth((c, token) => c.deleteAdminLeave(id, token), {
        errorMessage: 'You must be signed in to delete leave markers.',
      });
      await loadDashboard();
    },
  };
}
