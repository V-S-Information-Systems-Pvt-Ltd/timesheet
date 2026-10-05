import React from 'react';
import { ScrollView } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { LogTimeScreen } from '../src/screens/LogTimeScreen';
import { TimeEntryForm } from '../src/components/TimeEntryForm';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');
jest.setTimeout(15000);

const REFERENCE = {
  projects: [{ id: 'p-internal', name: 'Internal' }],
  activityTypes: [{ id: 'a1', name: 'Development' }],
};

function mockApiClient(reference: unknown = REFERENCE) {
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
        getReference: jest.fn().mockResolvedValue(reference),
        getDashboard: jest.fn().mockResolvedValue({}),
        createTimesheet: jest.fn().mockResolvedValue({ success: true }),
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

const body = (renderer: ReactTestRenderer.ReactTestRenderer) => JSON.stringify(renderer.toJSON());

/**
 * `findAllByProps` matches both the composite and the host node of one
 * element; only the host node is a distinct rendered alert.
 */
const hostAlerts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root
    .findAllByProps({ accessibilityRole: 'alert' })
    .filter((node) => typeof node.type === 'string');

const press = async (
  renderer: ReactTestRenderer.ReactTestRenderer,
  accessibilityLabel: string
) => {
  await ReactTestRenderer.act(async () => {
    await renderer.root.findAllByProps({ accessibilityLabel })[0].props.onPress();
  });
};

describe('TimeEntryForm inline validation', () => {
  it('reports a required field on blur, before any submit is attempted', async () => {
    mockApiClient();
    const renderer = await mount(
      <LogTimeScreen isDarkMode={false} onBack={jest.fn()} onSuccess={jest.fn()} />
    );

    const workDone = renderer.root.findAllByProps({ accessibilityLabel: 'Work Done' })[0];
    expect(workDone.props.accessibilityHint).toBeUndefined();
    expect(body(renderer)).not.toContain('Work description is required.');

    await ReactTestRenderer.act(async () => {
      workDone.props.onBlur();
    });

    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Work Done' })[0].props.accessibilityHint)
      .toBe('Work description is required.');
    expect(body(renderer)).toContain('Work description is required.');
    // The inline message is not the summary alert; submit-time failures own that.
    expect(hostAlerts(renderer)).toHaveLength(0);
  });

  it('clears the message once the touched field becomes valid', async () => {
    mockApiClient();
    const renderer = await mount(
      <LogTimeScreen isDarkMode={false} onBack={jest.fn()} onSuccess={jest.fn()} />
    );

    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel: 'Work Done' })[0].props.onBlur();
    });
    expect(body(renderer)).toContain('Work description is required.');

    await ReactTestRenderer.act(async () => {
      renderer.root
        .findAllByProps({ accessibilityLabel: 'Work Done' })[0]
        .props.onChangeText('Reviewed the offline queue');
    });

    expect(body(renderer)).not.toContain('Work description is required.');
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Work Done' })[0].props.accessibilityHint)
      .toBeUndefined();
  });

  it('keeps re-validating a touched numeric field as the value changes', async () => {
    mockApiClient();
    const renderer = await mount(
      <LogTimeScreen isDarkMode={false} onBack={jest.fn()} onSuccess={jest.fn()} />
    );

    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel: 'Hours Worked' })[0].props.onBlur();
    });
    expect(body(renderer)).toContain('Please enter valid hours between 0.25 and 24.');

    // Still out of range: the message stays.
    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel: 'Hours Worked' })[0].props.onChangeText('0.1');
    });
    expect(body(renderer)).toContain('Please enter valid hours between 0.25 and 24.');

    // In range: it clears without waiting for another submit.
    await ReactTestRenderer.act(async () => {
      renderer.root.findAllByProps({ accessibilityLabel: 'Hours Worked' })[0].props.onChangeText('0.25');
    });
    expect(body(renderer)).not.toContain('Please enter valid hours between 0.25 and 24.');
  });

  it('marks the offending input with the error border and keeps one summary alert', async () => {
    mockApiClient();
    const renderer = await mount(
      <LogTimeScreen isDarkMode={false} onBack={jest.fn()} onSuccess={jest.fn()} />
    );

    await press(renderer, 'Save timesheet entry');

    expect(hostAlerts(renderer)).toHaveLength(1);
    expect(body(renderer)).toContain('Please enter valid hours between 0.25 and 24.');
    expect(
      renderer.root.findAllByProps({ accessibilityLabel: 'Hours Worked' })[0].props.accessibilityHint
    ).toBe('Please enter valid hours between 0.25 and 24.');
  });
});

describe('TimeEntryForm scroll-to-first-error', () => {
  it('scrolls the first invalid field into view through the host scroll container', async () => {
    // No projects and no activity types: the first invalid field is the project.
    mockApiClient({ projects: [], activityTypes: [] });
    const scrollTo = jest.fn();
    const scrollViewRef = {
      current: { scrollTo } as unknown as ScrollView,
    } as React.RefObject<ScrollView | null>;

    const renderer = await mount(
      <TimeEntryForm
        isDarkMode={false}
        mode="create"
        onSubmit={jest.fn()}
        scrollViewRef={scrollViewRef}
      />
    );

    // Field offsets are measured through onLayout, which never fires in the
    // test renderer; drive it so the scroll target is a measured position.
    const measured = renderer.root.findAll(
      (node) => typeof node.props.onLayout === 'function'
    );
    expect(measured.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => {
      measured.forEach((node, index) => {
        node.props.onLayout({
          nativeEvent: { layout: { x: 0, y: index * 12, width: 320, height: 48 } },
        });
      });
    });

    await press(renderer, 'Save timesheet entry');

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ animated: true, y: expect.any(Number) })
    );

    expect(hostAlerts(renderer)).toHaveLength(1);
    expect(body(renderer)).toContain('Please select a project.');
  });

  it('still reports the failure, without scrolling, when no container was provided', async () => {
    mockApiClient({ projects: [], activityTypes: [] });
    const renderer = await mount(
      <TimeEntryForm isDarkMode={false} mode="create" onSubmit={jest.fn()} />
    );

    await press(renderer, 'Save timesheet entry');

    expect(hostAlerts(renderer)).toHaveLength(1);
    expect(body(renderer)).toContain('Please select a project.');
    expect(
      renderer.root.findAllByProps({ accessibilityLabel: 'Hours Worked' })[0].props.value
    ).toBe('');
  });
});
