import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { TimeEntryForm } from '../src/components/TimeEntryForm';
import { SearchablePickerModal } from '../src/components/SearchablePickerModal';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';
import { getPalette } from '../src/theme';

jest.mock('../src/api/client');

describe('Slice 06: Reliable mobile project selection', () => {
  const palette = getPalette(false);

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  describe('Default Project Selection in TimeEntryForm', () => {
    it('selects the exact Internal project in create mode regardless of sort order', async () => {
      const mockProjects = [
        { id: 'p-alpha', name: 'Project Alpha', so_number: 'SO-101' },
        { id: 'p-internal', name: 'Internal', so_number: null },
        { id: 'p-zeta', name: 'Project Zeta', so_number: 'SO-999' },
      ];

      (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
        return {
          getConfig: jest.fn().mockResolvedValue({}),
          refresh: jest.fn().mockResolvedValue({
            accessToken: 'access-123',
            refreshToken: 'refresh-123',
            accessTokenExpiresAt: '',
            sessionId: 's1',
          }),
          getMe: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'emp@example.com',
            role: 'user',
            permissionRole: 'user',
            hierarchyRole: 'user',
            isActive: true,
          }),
          getReference: jest.fn().mockResolvedValue({
            projects: mockProjects,
            activityTypes: [{ id: 'a1', name: 'Engineering' }],
          }),
          getDashboard: jest.fn().mockResolvedValue({}),
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <TimeEntryForm
              isDarkMode={false}
              mode="create"
              onSubmit={jest.fn()}
            />
          </SessionProvider>
          </ScreenTheme>
        );
      });

      const triggerCard = renderer!.root.findByProps({
        accessibilityLabel: 'Selected project: Internal. Tap to search or change project',
      });
      expect(triggerCard).toBeDefined();
    });

    it('shows unselected state when Internal project is absent in create mode', async () => {
      const mockProjects = [
        { id: 'p-alpha', name: 'Project Alpha', so_number: 'SO-101' },
        { id: 'p-beta', name: 'Project Beta', so_number: 'SO-102' },
      ];

      (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
        return {
          getConfig: jest.fn().mockResolvedValue({}),
          refresh: jest.fn().mockResolvedValue({
            accessToken: 'access-123',
            refreshToken: 'refresh-123',
            accessTokenExpiresAt: '',
            sessionId: 's1',
          }),
          getMe: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'emp@example.com',
            role: 'user',
            permissionRole: 'user',
            hierarchyRole: 'user',
            isActive: true,
          }),
          getReference: jest.fn().mockResolvedValue({
            projects: mockProjects,
            activityTypes: [{ id: 'a1', name: 'Engineering' }],
          }),
          getDashboard: jest.fn().mockResolvedValue({}),
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <TimeEntryForm
              isDarkMode={false}
              mode="create"
              onSubmit={jest.fn()}
            />
          </SessionProvider>
          </ScreenTheme>
        );
      });

      const triggerCard = renderer!.root.findByProps({
        accessibilityLabel: 'Selected project: None. Tap to search or change project',
      });
      expect(triggerCard).toBeDefined();
    });

    it('preserves initial project in edit mode or when provided explicitly', async () => {
      const mockProjects = [
        { id: 'p-internal', name: 'Internal' },
        { id: 'p-alpha', name: 'Project Alpha' },
      ];

      (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
        return {
          getConfig: jest.fn().mockResolvedValue({}),
          refresh: jest.fn().mockResolvedValue({
            accessToken: 'access-123',
            refreshToken: 'refresh-123',
            accessTokenExpiresAt: '',
            sessionId: 's1',
          }),
          getMe: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'emp@example.com',
            role: 'user',
            permissionRole: 'user',
            hierarchyRole: 'user',
            isActive: true,
          }),
          getReference: jest.fn().mockResolvedValue({
            projects: mockProjects,
            activityTypes: [{ id: 'a1', name: 'Engineering' }],
          }),
          getDashboard: jest.fn().mockResolvedValue({}),
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <TimeEntryForm
              initialValues={{
                projectId: 'p-alpha',
                hoursWorked: 4,
                workDone: 'Initial edit',
              }}
              isDarkMode={false}
              mode="edit"
              onSubmit={jest.fn()}
            />
          </SessionProvider>
          </ScreenTheme>
        );
      });

      const triggerCard = renderer!.root.findByProps({
        accessibilityLabel: 'Selected project: Project Alpha. Tap to search or change project',
      });
      expect(triggerCard).toBeDefined();
    });
  });

  describe('SearchablePickerModal Matching & States', () => {
    const sampleItems = Array.from({ length: 60 }, (_, i) => ({
      id: `p-${i}`,
      name: `Client Project ${i}`,
      subtitle: `SO: SO-${1000 + i}`,
    }));

    it('matches by project name and SO code without dropping items', async () => {
      const onSelect = jest.fn();
      const onClose = jest.fn();

      let renderer: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SearchablePickerModal
            items={sampleItems}
            onClose={onClose}
            onSelect={onSelect}
            palette={palette}
            selectedId="p-0"
            title="Select Project"
            visible={true}
          />
        );
      });

      const searchInput = renderer!.root.findByProps({ accessibilityLabel: 'Search...' });

      // 1. Search by name
      await ReactTestRenderer.act(async () => {
        searchInput.props.onChangeText('Project 42');
      });

      const item42 = renderer!.root.findByProps({ accessibilityLabel: 'Client Project 42' });
      expect(item42).toBeDefined();

      // 2. Search by SO code
      await ReactTestRenderer.act(async () => {
        searchInput.props.onChangeText('SO-1055');
      });

      const item55 = renderer!.root.findByProps({ accessibilityLabel: 'Client Project 55' });
      expect(item55).toBeDefined();

      await ReactTestRenderer.act(async () => {
        item55.props.onPress();
      });

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-55', name: 'Client Project 55' }));
      expect(onClose).toHaveBeenCalled();
    });

    it('maintains distinct loading, error, empty, and no-match states', async () => {
      let renderer: ReactTestRenderer.ReactTestRenderer;

      // 1. Loading state
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SearchablePickerModal
            isLoading={true}
            items={[]}
            onClose={jest.fn()}
            onSelect={jest.fn()}
            palette={palette}
            selectedId=""
            title="Select Project"
            visible={true}
          />
        );
      });
      expect(JSON.stringify(renderer!.toJSON())).toContain('Loading items...');

      // 2. Error state
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SearchablePickerModal
            error="Failed to load project reference"
            items={[]}
            onClose={jest.fn()}
            onSelect={jest.fn()}
            palette={palette}
            selectedId=""
            title="Select Project"
            visible={true}
          />
        );
      });
      expect(JSON.stringify(renderer!.toJSON())).toContain('Failed to load project reference');

      // 3. Empty state (0 items)
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SearchablePickerModal
            items={[]}
            onClose={jest.fn()}
            onSelect={jest.fn()}
            palette={palette}
            selectedId=""
            title="Select Project"
            visible={true}
          />
        );
      });
      expect(JSON.stringify(renderer!.toJSON())).toContain('No items available.');

      // 4. No search results found
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SearchablePickerModal
            items={sampleItems}
            onClose={jest.fn()}
            onSelect={jest.fn()}
            palette={palette}
            selectedId=""
            title="Select Project"
            visible={true}
          />
        );
      });
      const searchInput = renderer!.root.findByProps({ accessibilityLabel: 'Search...' });
      await ReactTestRenderer.act(async () => {
        searchInput.props.onChangeText('NonExistentProjectXYZ');
      });
      expect(JSON.stringify(renderer!.toJSON())).toContain('No results found for');
    });
  });
});
