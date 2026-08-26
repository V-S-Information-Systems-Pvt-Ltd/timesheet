import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('ProfileScreen', () => {
  it('renders profile details and handles sign out interaction', async () => {
    const mockLogout = jest.fn().mockResolvedValue(undefined);
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({ backend: 'native' }),
        logout: mockLogout,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <ProfileScreen isDarkMode={false} onBack={onBack} />
        </SessionProvider>
      );
    });

    const backBtn = renderer!.root.findByProps({ accessibilityLabel: 'Back to dashboard' });
    const signOutBtn = renderer!.root.findByProps({ accessibilityLabel: 'Sign out' });
    const disconnectBtn = renderer!.root.findByProps({ accessibilityLabel: 'Disconnect workspace' });

    expect(backBtn).toBeDefined();
    expect(signOutBtn).toBeDefined();
    expect(disconnectBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      backBtn.props.onPress();
    });
    expect(onBack).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      await signOutBtn.props.onPress();
    });
  });
});
