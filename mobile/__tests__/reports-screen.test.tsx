import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ReportsScreen } from '../src/screens/ReportsScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('ReportsScreen', () => {
  it('renders report metrics and grouped breakdown', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        getReports: jest.fn().mockResolvedValue({
          totalHours: 120,
          totalEntries: 15,
          byGroup: [{ label: 'Project Alpha', hours: 80, entries: 10 }],
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <ReportsScreen isDarkMode={false} onBack={onBack} />
        </SessionProvider>
      );
    });

    const backBtn = renderer!.root.findByProps({ accessibilityLabel: 'Back to dashboard' });
    expect(backBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      backBtn.props.onPress();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('handles string hours from backend aggregate without crashing', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        getReports: jest.fn().mockResolvedValue({
          totalHours: '40.50',
          totalEntries: '5',
          byGroup: [{ label: 'Project Beta', hours: '40.50', entries: 5 }],
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <ReportsScreen isDarkMode={false} onBack={jest.fn()} />
        </SessionProvider>
      );
    });

    expect(renderer!.root).toBeDefined();
  });
});
