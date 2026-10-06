import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ReportsScreen } from '../src/screens/ReportsScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('a load failure never reads as an empty result (R3)', () => {
  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
  });

  it('ReportsScreen shows the error with no empty-state copy and no zero totals, with a retry', async () => {
    jest.useFakeTimers();
    const getReports = jest.fn().mockRejectedValue(new Error('Server exploded'));
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123', refreshToken: 'refresh-123', accessTokenExpiresAt: '', sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1', email: 'u@x.com', role: 'user', permissionRole: 'user', hierarchyRole: 'user', isActive: true,
        }),
        getReports,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    let renderer: ReactTestRenderer.ReactTestRenderer = undefined as never;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <ReportsScreen isDarkMode={false} onBack={jest.fn()} />
          </SessionProvider>
        </ScreenTheme>
      );
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
      jest.runOnlyPendingTimers();
    });

    const texts = renderer.root
      .findAllByType(require('react-native').Text)
      .flatMap((node) => (node.props as { children?: unknown }).children)
      .filter((child): child is string => typeof child === 'string');

    // The error is shown...
    expect(texts.some((t) => t.includes('Server exploded'))).toBe(true);
    // ...and the empty claim and zero totals are NOT shown beside it.
    expect(texts.some((t) => t.includes('No hours logged'))).toBe(false);
    expect(texts.some((t) => t === '0.0')).toBe(false);

    // A retry affordance exists.
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Retry loading report' }).length).toBeGreaterThan(0);

    // Retrying re-issues the request.
    getReports.mockClear();
    getReports.mockResolvedValue({ totalHours: 5, totalEntries: 2, byGroup: [] });
    await ReactTestRenderer.act(async () => {
      await renderer.root.findAllByProps({ accessibilityLabel: 'Retry loading report' })[0].props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
      jest.runOnlyPendingTimers();
    });
    expect(getReports).toHaveBeenCalledTimes(1);
  });
});
