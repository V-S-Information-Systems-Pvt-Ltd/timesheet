import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { LogTimeScreen } from '../src/screens/LogTimeScreen';
import { EditTimeScreen } from '../src/screens/EditTimeScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';
import type { TimesheetEntry } from '../src/api/contracts';

jest.mock('../src/api/client');
jest.setTimeout(15000);

const REFERENCE = {
  projects: [
    { id: 'p-internal', name: 'Internal' },
    { id: 'p-alpha', name: 'Project Alpha' },
  ],
  activityTypes: [{ id: 'a1', name: 'Development' }],
};

function mockApiClient(overrides: Record<string, unknown> = {}) {
  (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(
    () =>
      ({
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
        getReference: jest.fn().mockResolvedValue(REFERENCE),
        getDashboard: jest.fn().mockResolvedValue({}),
        createTimesheet: jest.fn().mockResolvedValue({ success: true }),
        updateTimesheet: jest.fn().mockResolvedValue({ success: true }),
        ...overrides,
      } as unknown as ApiClient)
  );
}

async function mount(element: React.ReactElement) {
  const store = new MemoryTokenStore();
  await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          {element}
        </SessionProvider>
      </ScreenTheme>
    );
  });
  return renderer;
}

const enteredEntry: TimesheetEntry = {
  id: 'ts-101',
  user_id: 'u1',
  project_id: 'p-alpha',
  project_name: 'Project Alpha',
  activity_type_id: 'a1',
  activity_name: 'Development',
  log_date: '2026-08-26',
  hours_worked: 6.5,
  work_done: 'Initial development implementation',
  created_at: '2026-08-26T10:00:00.000Z',
};

describe('TimeEntryForm dirty reporting', () => {
  it('stays clean when the asynchronous default project and activity arrive', async () => {
    mockApiClient();
    const onDirtyChange = jest.fn();
    const renderer = await mount(
      <LogTimeScreen
        isDarkMode={false}
        onBack={jest.fn()}
        onDirtyChange={onDirtyChange}
        onSuccess={jest.fn()}
      />
    );

    // The 'internal' project and first activity type are filled in for the user
    // rather than typed by them, so they must not read as unsaved changes.
    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: 'Selected project: Internal. Tap to search or change project',
      }).length
    ).toBeGreaterThan(0);

    expect(onDirtyChange).toHaveBeenCalled();
    expect(
      onDirtyChange.mock.calls.filter(([isDirty]) => isDirty === true)
    ).toEqual([]);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('reports typed changes as dirty and clean again once reverted', async () => {
    mockApiClient();
    const onDirtyChange = jest.fn();
    const renderer = await mount(
      <LogTimeScreen
        isDarkMode={false}
        onBack={jest.fn()}
        onDirtyChange={onDirtyChange}
        onSuccess={jest.fn()}
      />
    );

    const workDoneInput = renderer.root.findAllByProps({ accessibilityLabel: 'Work Done' })[0];

    await ReactTestRenderer.act(async () => {
      workDoneInput.props.onChangeText('Reviewed the offline queue');
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await ReactTestRenderer.act(async () => {
      workDoneInput.props.onChangeText('');
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('clears the guard before handing control to the parent on save', async () => {
    mockApiClient();
    const onDirtyChange = jest.fn();
    const onSuccess = jest.fn();
    const renderer = await mount(
      <LogTimeScreen
        isDarkMode={false}
        onBack={jest.fn()}
        onDirtyChange={onDirtyChange}
        onSuccess={onSuccess}
      />
    );

    await ReactTestRenderer.act(async () => {
      renderer.root
        .findAllByProps({ accessibilityLabel: 'Hours Worked' })[0]
        .props.onChangeText('8');
      renderer.root
        .findAllByProps({ accessibilityLabel: 'Work Done' })[0]
        .props.onChangeText('Reviewed the offline queue');
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await ReactTestRenderer.act(async () => {
      await renderer.root
        .findAllByProps({ accessibilityLabel: 'Save timesheet entry' })[0]
        .props.onPress();
    });

    // The parent navigates away on success; a still-dirty flag would raise the
    // discard prompt over a write that already succeeded.
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(onSuccess).toHaveBeenCalledWith({ queued: false });
  });

  it('reports an edit-mode form as clean on mount', async () => {
    mockApiClient();
    const onDirtyChange = jest.fn();
    const renderer = await mount(
      <EditTimeScreen
        entry={enteredEntry}
        isDarkMode={false}
        onBack={jest.fn()}
        onDirtyChange={onDirtyChange}
        onSuccess={jest.fn()}
      />
    );

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await ReactTestRenderer.act(async () => {
      renderer.root
        .findAllByProps({ accessibilityLabel: 'Hours Worked' })[0]
        .props.onChangeText('7.5');
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });
});
