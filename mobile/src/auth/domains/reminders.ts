import React from 'react';
import type {
  CreateReminderInput,
  ReminderItem,
  GlobalReminderItem,
  CreateGlobalReminderInput,
} from '../../api/contracts';
import type { WithAuth } from './types';

export interface RemindersDomainCallbacks {
  setGlobalReminders: React.Dispatch<React.SetStateAction<GlobalReminderItem[]>>;
  loadGlobalReminders: () => Promise<GlobalReminderItem[]>;
}

export function createRemindersActions(
  withAuth: WithAuth,
  callbacks: RemindersDomainCallbacks
) {
  const { setGlobalReminders, loadGlobalReminders } = callbacks;

  return {
    listReminders: async (): Promise<ReminderItem[]> => {
      return withAuth((c, token) => c.listReminders(token), { defaultValue: [] });
    },

    createReminder: async (input: CreateReminderInput): Promise<void> => {
      await withAuth((c, token) => c.createReminder(token, input), {
        errorMessage: 'You must be signed in to create reminders.',
      });
    },

    updateReminder: async (id: string, done: boolean): Promise<void> => {
      await withAuth((c, token) => c.updateReminder(token, id, done), {
        errorMessage: 'You must be signed in to update reminders.',
      });
    },

    deleteReminder: async (id: string): Promise<void> => {
      await withAuth((c, token) => c.deleteReminder(token, id), {
        errorMessage: 'You must be signed in to delete reminders.',
      });
    },

    loadGlobalReminders: async (): Promise<GlobalReminderItem[]> => {
      const data = await withAuth((c, token) => c.listGlobalReminders(token), {
        defaultValue: [],
      });
      setGlobalReminders(data);
      return data;
    },

    dismissGlobalReminder: async (id: string): Promise<void> => {
      setGlobalReminders((prev) => prev.filter((g) => g.id !== id));
      try {
        await withAuth((c, token) => c.dismissGlobalReminder(token, id));
      } catch (err) {
        await loadGlobalReminders();
        throw err;
      }
    },

    listAllGlobalReminders: async (): Promise<GlobalReminderItem[]> => {
      return withAuth((c, token) => c.listAllGlobalReminders(token), {
        defaultValue: [],
      });
    },

    createAdminGlobalReminder: async (
      input: CreateGlobalReminderInput
    ): Promise<GlobalReminderItem> => {
      const res = await withAuth((c, token) => c.createAdminGlobalReminder(input, token), {
        errorMessage: 'You must be signed in to create global reminders.',
      });
      await loadGlobalReminders();
      return res;
    },

    updateAdminGlobalReminder: async (
      id: string,
      input: Partial<CreateGlobalReminderInput>
    ): Promise<{ success: boolean; id: string }> => {
      const res = await withAuth(
        (c, token) => c.updateAdminGlobalReminder(id, input, token),
        { errorMessage: 'You must be signed in to update global reminders.' }
      );
      await loadGlobalReminders();
      return res;
    },

    deleteAdminGlobalReminder: async (id: string): Promise<void> => {
      await withAuth((c, token) => c.deleteAdminGlobalReminder(id, token), {
        errorMessage: 'You must be signed in to delete global reminders.',
      });
      await loadGlobalReminders();
    },
  };
}
