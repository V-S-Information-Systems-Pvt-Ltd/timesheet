import type {
  ActivityTypeAdminItem,
  BackfillSettings,
  CreateActivityTypeInput,
  CreateAdminUserInput,
  CreateProjectInput,
  CreateTitleInput,
  MobileReferenceData,
  PersonProfile,
  ProjectAdminItem,
  ReclassifyTitleInput,
  TitleAdminItem,
  TitleImpactInfo,
  UpdateActivityTypeInput,
  UpdateAdminUserInput,
  UpdateProjectInput,
} from '../../api/contracts';
import type { WithAuth } from './types';

export interface AdminReferenceDomainCallbacks {
  loadReference: () => Promise<MobileReferenceData | null>;
}

export function createAdminReferenceActions(
  withAuth: WithAuth,
  callbacks: AdminReferenceDomainCallbacks
) {
  const { loadReference } = callbacks;

  return {
    // Projects
    listAdminProjects: async (): Promise<ProjectAdminItem[]> => {
      return withAuth((c, token) => c.listAdminProjects(token), { defaultValue: [] });
    },

    createAdminProject: async (input: CreateProjectInput): Promise<ProjectAdminItem> => {
      const res = await withAuth((c, token) => c.createAdminProject(input, token), {
        errorMessage: 'You must be signed in to create a project.',
      });
      await loadReference();
      return res;
    },

    updateAdminProject: async (
      id: string,
      input: UpdateProjectInput
    ): Promise<ProjectAdminItem> => {
      const res = await withAuth((c, token) => c.updateAdminProject(id, input, token), {
        errorMessage: 'You must be signed in to update a project.',
      });
      await loadReference();
      return res;
    },

    deleteAdminProject: async (id: string): Promise<void> => {
      await withAuth((c, token) => c.deleteAdminProject(id, token), {
        errorMessage: 'You must be signed in to delete a project.',
      });
      await loadReference();
    },

    // Activity Types
    listAdminActivityTypes: async (): Promise<ActivityTypeAdminItem[]> => {
      return withAuth((c, token) => c.listAdminActivityTypes(token), { defaultValue: [] });
    },

    createAdminActivityType: async (
      input: CreateActivityTypeInput
    ): Promise<ActivityTypeAdminItem> => {
      const res = await withAuth((c, token) => c.createAdminActivityType(input, token), {
        errorMessage: 'You must be signed in to create an activity type.',
      });
      await loadReference();
      return res;
    },

    updateAdminActivityType: async (
      id: string,
      input: UpdateActivityTypeInput
    ): Promise<ActivityTypeAdminItem> => {
      const res = await withAuth((c, token) => c.updateAdminActivityType(id, input, token), {
        errorMessage: 'You must be signed in to update an activity type.',
      });
      await loadReference();
      return res;
    },

    deleteAdminActivityType: async (id: string): Promise<void> => {
      await withAuth((c, token) => c.deleteAdminActivityType(id, token), {
        errorMessage: 'You must be signed in to delete an activity type.',
      });
      await loadReference();
    },

    // Users
    listAdminUsers: async (): Promise<PersonProfile[]> => {
      return withAuth((c, token) => c.listAdminUsers(token), { defaultValue: [] });
    },

    createAdminUser: async (input: CreateAdminUserInput): Promise<PersonProfile> => {
      const res = await withAuth((c, token) => c.createAdminUser(input, token), {
        errorMessage: 'You must be signed in to create a user.',
      });
      await loadReference();
      return res;
    },

    updateAdminUser: async (
      id: string,
      input: UpdateAdminUserInput
    ): Promise<PersonProfile> => {
      const res = await withAuth((c, token) => c.updateAdminUser(id, input, token), {
        errorMessage: 'You must be signed in to update a user.',
      });
      await loadReference();
      return res;
    },

    // Titles
    listAdminTitles: async (): Promise<TitleAdminItem[]> => {
      return withAuth((c, token) => c.listAdminTitles(token), { defaultValue: [] });
    },

    createAdminTitle: async (input: CreateTitleInput): Promise<TitleAdminItem> => {
      const res = await withAuth((c, token) => c.createAdminTitle(input, token), {
        errorMessage: 'You must be signed in to create a title.',
      });
      await loadReference();
      return res;
    },

    getAdminTitleImpact: async (
      name: string,
      proposedRole: string
    ): Promise<TitleImpactInfo> => {
      return withAuth((c, token) => c.getAdminTitleImpact(name, proposedRole, token), {
        errorMessage: 'You must be signed in to check title impact.',
      });
    },

    reclassifyAdminTitle: async (
      input: ReclassifyTitleInput
    ): Promise<{ name: string; hierarchyRole: string; affectedCount?: number }> => {
      const res = await withAuth((c, token) => c.reclassifyAdminTitle(input, token), {
        errorMessage: 'You must be signed in to reclassify a title.',
      });
      await loadReference();
      return res;
    },

    deleteAdminTitle: async (name: string): Promise<void> => {
      await withAuth((c, token) => c.deleteAdminTitle(name, token), {
        errorMessage: 'You must be signed in to delete a title.',
      });
      await loadReference();
    },

    // Backfill Settings
    getBackfillSettings: async (): Promise<BackfillSettings> => {
      return withAuth((c, token) => c.getBackfillSettings(token), {
        defaultValue: { mode: 'days', windowDays: 7, extraDays: 0 },
      });
    },

    updateBackfillSettings: async (settings: BackfillSettings): Promise<BackfillSettings> => {
      return withAuth((c, token) => c.updateBackfillSettings(settings, token), {
        errorMessage: 'You must be signed in to update backfill settings.',
      });
    },
  };
}
