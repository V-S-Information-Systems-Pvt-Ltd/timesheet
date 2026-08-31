import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { LayoutCustomizerScreen } from '../src/screens/LayoutCustomizerScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';
import { DEFAULT_MOBILE_LAYOUT } from '../src/navigation/modules';

jest.mock('../src/api/client');
jest.setTimeout(15000);

describe('LayoutCustomizerScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders modules list and allows toggling non-essential modules', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        getLayout: jest.fn().mockResolvedValue({
          layout: DEFAULT_MOBILE_LAYOUT,
          savedLayout: null,
          defaultLayout: DEFAULT_MOBILE_LAYOUT,
          capabilities: {
            canViewTeam: true,
            canManageProjects: true,
            canManageActivities: true,
            canManageUsers: true,
            canManageSettings: true,
          },
        }),
        updateLayout: jest.fn().mockResolvedValue({
          layout: DEFAULT_MOBILE_LAYOUT,
          savedLayout: DEFAULT_MOBILE_LAYOUT,
        }),
        resetLayout: jest.fn().mockResolvedValue({
          layout: DEFAULT_MOBILE_LAYOUT,
          savedLayout: null,
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    const onGoBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <LayoutCustomizerScreen isDarkMode={false} onGoBack={onGoBack} />
        </SessionProvider>
      );
    });

    // Verify back button is accessible
    const backBtn = renderer!.root.findByProps({ accessibilityLabel: 'Back to more' });
    expect(backBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      backBtn.props.onPress();
    });
    expect(onGoBack).toHaveBeenCalledTimes(1);

    // Verify essential module switch is disabled
    const logTimeSwitch = renderer!.root.findByProps({ accessibilityLabel: 'Toggle Log Time' });
    expect(logTimeSwitch.props.disabled).toBe(true);

    // Verify non-essential module switch is enabled
    const leavesSwitch = renderer!.root.findByProps({ accessibilityLabel: 'Toggle Mark Leave' });
    expect(leavesSwitch.props.disabled).toBe(false);
  });
});
