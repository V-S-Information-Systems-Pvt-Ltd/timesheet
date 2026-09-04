import React from 'react';
import type {
  MobileConfig,
  MobileLayout,
  MobileLayoutResponse,
  WorkspaceBranding,
} from '../../api/contracts';
import type { WithAuth } from './types';

export interface SettingsLayoutDomainCallbacks {
  setLayout: (layout: MobileLayout) => void;
  setConfig: React.Dispatch<React.SetStateAction<MobileConfig | null>>;
}

export function createSettingsLayoutActions(
  withAuth: WithAuth,
  callbacks: SettingsLayoutDomainCallbacks
) {
  const { setLayout, setConfig } = callbacks;

  return {
    loadLayout: async (): Promise<MobileLayoutResponse | null> => {
      const res = await withAuth((c, token) => c.getLayout(token), {
        defaultValue: null,
      });
      if (res) setLayout(res.layout);
      return res;
    },

    updateLayout: async (newLayout: MobileLayout): Promise<void> => {
      const res = await withAuth((c, token) => c.updateLayout(newLayout, token), {
        errorMessage: 'You must be signed in to update layout.',
      });
      setLayout(res.layout);
    },

    resetLayout: async (): Promise<void> => {
      const res = await withAuth((c, token) => c.resetLayout(token), {
        errorMessage: 'You must be signed in to reset layout.',
      });
      setLayout(res.layout);
    },

    loadAdminDefaultLayout: async (): Promise<MobileLayout> => {
      const res = await withAuth((c, token) => c.getAdminDefaultLayout(token), {
        errorMessage: 'You must be signed in to load default layout.',
      });
      return res.layout;
    },

    updateAdminDefaultLayout: async (newLayout: MobileLayout): Promise<MobileLayout> => {
      const res = await withAuth(
        (c, token) => c.updateAdminDefaultLayout(newLayout, token),
        { errorMessage: 'You must be signed in to update default layout.' }
      );
      return res.layout;
    },

    resetAdminDefaultLayout: async (): Promise<MobileLayout> => {
      const res = await withAuth((c, token) => c.resetAdminDefaultLayout(token), {
        errorMessage: 'You must be signed in to reset default layout.',
      });
      return res.layout;
    },

    updateBranding: async (newBranding: WorkspaceBranding): Promise<void> => {
      const updated = await withAuth((c, token) => c.updateBranding(newBranding, token), {
        errorMessage: 'You must be signed in to update branding.',
      });
      setConfig((prev) => (prev ? { ...prev, branding: updated } : prev));
    },

    resetBranding: async (): Promise<void> => {
      const updated = await withAuth((c, token) => c.resetBranding(token), {
        errorMessage: 'You must be signed in to reset branding.',
      });
      setConfig((prev) => (prev ? { ...prev, branding: updated } : prev));
    },
  };
}
