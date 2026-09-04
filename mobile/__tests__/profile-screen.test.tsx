import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('ProfileScreen', () => {
  it('renders profile details and handles sign out interaction', async () => {
    const mockLogout = jest.fn().mockResolvedValue(undefined);
    const mockChangePw = jest.fn().mockResolvedValue({ success: true });
    const mockGetRef = jest.fn().mockResolvedValue({ projects: [], activityTypes: [], titles: ['Engineer', 'Manager'] });
    const mockUpdateProfile = jest.fn().mockResolvedValue({
      id: 'u1',
      email: 'emp@example.com',
      department: 'Engineering',
      title: 'Engineer',
      role: 'user',
      isActive: true,
    });

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({ backend: 'native' }),
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
        getReference: mockGetRef,
        logout: mockLogout,
        changePassword: mockChangePw,
        updateProfile: mockUpdateProfile,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'ref-1', sessionId: 's1' });
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <ProfileScreen isDarkMode={false} onBack={onBack} />
        </SessionProvider>
        </ScreenTheme>
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

    // Test edit profile mode
    const editToggle = renderer!.root.findByProps({ accessibilityLabel: 'Edit profile' });
    await ReactTestRenderer.act(async () => {
      editToggle.props.onPress();
    });

    const deptInput = renderer!.root.findByProps({ accessibilityLabel: 'Department' });
    const titleInput = renderer!.root.findByProps({ accessibilityLabel: 'Job Title' });

    await ReactTestRenderer.act(async () => {
      deptInput.props.onChangeText('Engineering');
      titleInput.props.onChangeText('Engineer');
    });

    const saveBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save profile changes' });
    await ReactTestRenderer.act(async () => {
      await saveBtn.props.onPress();
    });

    expect(mockUpdateProfile).toHaveBeenCalledWith('access-123', {
      department: 'Engineering',
      title: 'Engineer',
    });
  });
});
