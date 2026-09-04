import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import {
  workspaceStore,
  validateWorkspaceUrl,
  getBuildTimeDefaultWorkspaceUrl,
  DISCONNECTED_SENTINEL,
} from '../src/storage/workspace-store';
import { themeStore, type ThemePreference } from '../src/storage/theme-store';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import { MoreScreen } from '../src/screens/MoreScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';

declare const process: { env: Record<string, string | undefined> };

jest.mock('../src/api/client');
jest.setTimeout(15000);

describe('Build-time default workspace and theme preference', () => {
  beforeEach(async () => {
    await workspaceStore.reset();
    await themeStore.clear();
    delete process.env.EXPO_PUBLIC_DEFAULT_WORKSPACE_URL;
    delete process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_URL;
    delete process.env.DEFAULT_WORKSPACE_URL;
  });

  describe('Workspace URL validation & build-time default precedence', () => {
    it('validates URLs correctly and strips trailing slashes', () => {
      expect(validateWorkspaceUrl('https://timesheet.example.com/')).toBe('https://timesheet.example.com');
      expect(validateWorkspaceUrl('http://192.168.1.50:3000/app/')).toBe('http://192.168.1.50:3000/app');
      expect(validateWorkspaceUrl('timesheet.example.com')).toBe('https://timesheet.example.com');

      // Invalid schemes or formats
      expect(validateWorkspaceUrl('ftp://example.com')).toBeNull();
      expect(validateWorkspaceUrl(`javascript${':alert(1)'}`)).toBeNull();
      expect(validateWorkspaceUrl('not a url %%%')).toBeNull();
      expect(validateWorkspaceUrl('')).toBeNull();
      expect(validateWorkspaceUrl(null)).toBeNull();
      expect(validateWorkspaceUrl(DISCONNECTED_SENTINEL)).toBeNull();
    });

    it('rejects URLs containing embedded credentials (user:pass)', () => {
      expect(validateWorkspaceUrl('https://admin:secret@timesheet.example.com')).toBeNull();
      expect(validateWorkspaceUrl('http://user@timesheet.example.com')).toBeNull();
    });

    it('reads build-time default workspace URL from env variables', () => {
      process.env.EXPO_PUBLIC_DEFAULT_WORKSPACE_URL = 'https://default.example.com';
      expect(getBuildTimeDefaultWorkspaceUrl()).toBe('https://default.example.com');

      delete process.env.EXPO_PUBLIC_DEFAULT_WORKSPACE_URL;
      process.env.NEXT_PUBLIC_DEFAULT_WORKSPACE_URL = 'https://next-default.example.com/';
      expect(getBuildTimeDefaultWorkspaceUrl()).toBe('https://next-default.example.com');
    });

    it('pre-populates connection with build-time URL only when no user choice exists', async () => {
      process.env.EXPO_PUBLIC_DEFAULT_WORKSPACE_URL = 'https://buildtime.example.com';

      // 1. Initial virgin state: returns build-time default
      expect(await workspaceStore.get()).toBe('https://buildtime.example.com');

      // 2. User sets custom workspace: custom choice wins
      await workspaceStore.set('https://custom.example.com');
      expect(await workspaceStore.get()).toBe('https://custom.example.com');

      // 3. User disconnects explicitly: returns null, does NOT revert to build-time default
      await workspaceStore.clear();
      expect(await workspaceStore.get()).toBeNull();

      // 4. Hard reset: returns build-time default again
      await workspaceStore.reset();
      expect(await workspaceStore.get()).toBe('https://buildtime.example.com');
    });
  });

  describe('Theme preference persistence and dynamic switching', () => {
    it('defaults to system theme preference and allows light/dark overrides', async () => {
      expect(await themeStore.get()).toBe('system');

      await themeStore.set('dark');
      expect(await themeStore.get()).toBe('dark');

      await themeStore.set('light');
      expect(await themeStore.get()).toBe('light');

      // Ignores invalid inputs
      await themeStore.set('invalid' as ThemePreference);
      expect(await themeStore.get()).toBe('light');

      await themeStore.clear();
      expect(await themeStore.get()).toBe('system');
    });

    it('ThemeProvider provides active theme and reflects preference changes', async () => {
      function ThemeConsumer() {
        const { preference, isDarkMode, setPreference } = useTheme();
        return (
          <>
            <span test-id="pref">{preference}</span>
            <span test-id="dark">{String(isDarkMode)}</span>
            <button test-id="btn-dark" onClick={() => setPreference('dark')} />
            <button test-id="btn-light" onClick={() => setPreference('light')} />
          </>
        );
      }

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialPreference="light">
            <ThemeConsumer />
          </ThemeProvider>
        );
      });

      const prefNode = renderer!.root.findByProps({ 'test-id': 'pref' });
      expect(prefNode.props.children).toBe('light');

      const darkNode = renderer!.root.findByProps({ 'test-id': 'dark' });
      expect(darkNode.props.children).toBe('false');

      // Switch to dark
      const btnDark = renderer!.root.findByProps({ 'test-id': 'btn-dark' });
      await ReactTestRenderer.act(async () => {
        btnDark.props.onClick();
      });

      expect(renderer!.root.findByProps({ 'test-id': 'pref' }).props.children).toBe('dark');
      expect(renderer!.root.findByProps({ 'test-id': 'dark' }).props.children).toBe('true');
    });

    it('renders theme selector in MoreScreen and allows selecting theme', async () => {
      const store = new MemoryTokenStore();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ThemeProvider initialPreference="system">
            <ScreenTheme>
            <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
              <MoreScreen isDarkMode={false} onNavigate={jest.fn()} />
            </SessionProvider>
            </ScreenTheme>
          </ThemeProvider>
        );
      });

      const darkBtn = renderer!.root.findByProps({ accessibilityLabel: 'Theme option dark' });
      expect(darkBtn).toBeDefined();

      await ReactTestRenderer.act(async () => {
        darkBtn.props.onPress();
      });

      expect(await themeStore.get()).toBe('dark');
    });
  });
});
