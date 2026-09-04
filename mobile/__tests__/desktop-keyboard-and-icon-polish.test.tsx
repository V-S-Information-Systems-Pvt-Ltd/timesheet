import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SignInScreen } from '../src/screens/SignInScreen';
import { Icon } from '../src/components/Icon';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('Slice 07: Desktop keyboard and cross-platform icon polish', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  describe('SignInScreen Keyboard & Enter-key submission', () => {
    it('email submit triggers focus to password and password submit invokes signIn', async () => {
      const mockSignIn = jest.fn().mockResolvedValue({
        accessToken: 'acc-1',
        refreshToken: 'ref-1',
        accessTokenExpiresAt: '',
        sessionId: 's1',
      });

      (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
        return {
          getConfig: jest.fn().mockResolvedValue({}),
          login: mockSignIn,
          getMe: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'admin@vsis.lk',
            role: 'admin',
            permissionRole: 'admin',
            hierarchyRole: 'manager',
            isActive: true,
          }),
          getDashboard: jest.fn().mockResolvedValue({}),
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <SignInScreen isDarkMode={false} onBackToConnect={jest.fn()} />
          </SessionProvider>
        );
      });

      const emailInput = renderer!.root.findByProps({ accessibilityLabel: 'Email address' });
      const passwordInput = renderer!.root.findByProps({ accessibilityLabel: 'Password' });

      expect(emailInput.props.returnKeyType).toBe('next');
      expect(passwordInput.props.returnKeyType).toBe('go');

      // Enter credentials
      await ReactTestRenderer.act(async () => {
        emailInput.props.onChangeText('admin@vsis.lk');
        passwordInput.props.onChangeText('Password123!');
      });

      // Submit from Email input moves to Password
      await ReactTestRenderer.act(async () => {
        emailInput.props.onSubmitEditing();
      });

      // Submit from Password input triggers Sign In
      await ReactTestRenderer.act(async () => {
        await passwordInput.props.onSubmitEditing();
      });

      expect(mockSignIn).toHaveBeenCalledWith({ email: 'admin@vsis.lk', password: 'Password123!' });
    });

    it('enter key during submission cannot create duplicate requests', async () => {
      let resolveLogin: (val: unknown) => void;
      const loginPromise = new Promise((resolve) => {
        resolveLogin = resolve;
      });
      const mockSignIn = jest.fn().mockReturnValue(loginPromise);

      (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
        return {
          getConfig: jest.fn().mockResolvedValue({}),
          login: mockSignIn,
          getMe: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'admin@vsis.lk',
            role: 'admin',
            permissionRole: 'admin',
            hierarchyRole: 'manager',
            isActive: true,
          }),
          getDashboard: jest.fn().mockResolvedValue({}),
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <SignInScreen isDarkMode={false} onBackToConnect={jest.fn()} />
          </SessionProvider>
        );
      });

      const emailInput = renderer!.root.findByProps({ accessibilityLabel: 'Email address' });
      const passwordInput = renderer!.root.findByProps({ accessibilityLabel: 'Password' });

      await ReactTestRenderer.act(async () => {
        emailInput.props.onChangeText('admin@vsis.lk');
        passwordInput.props.onChangeText('Password123!');
      });

      // First submit
      await ReactTestRenderer.act(async () => {
        passwordInput.props.onSubmitEditing();
      });
      expect(mockSignIn).toHaveBeenCalledTimes(1);

      // Subsequent enters while in flight are ignored
      await ReactTestRenderer.act(async () => {
        passwordInput.props.onSubmitEditing();
        passwordInput.props.onSubmitEditing();
      });
      expect(mockSignIn).toHaveBeenCalledTimes(1);

      // Finish login
      await ReactTestRenderer.act(async () => {
        resolveLogin!({
          accessToken: 'acc-1',
          refreshToken: 'ref-1',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        });
      });
    });

    it('handles show/hide password toggle without losing keyboard submission capability', async () => {
      const mockSignIn = jest.fn().mockResolvedValue({
        accessToken: 'acc-1',
        refreshToken: 'ref-1',
        accessTokenExpiresAt: '',
        sessionId: 's1',
      });

      (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
        return {
          getConfig: jest.fn().mockResolvedValue({}),
          login: mockSignIn,
          getMe: jest.fn().mockResolvedValue({ id: 'u1', email: 'u@vsis.lk', role: 'user', isActive: true }),
          getDashboard: jest.fn().mockResolvedValue({}),
        } as unknown as ApiClient;
      });

      const store = new MemoryTokenStore();
      let renderer: ReactTestRenderer.ReactTestRenderer;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
            <SignInScreen isDarkMode={false} onBackToConnect={jest.fn()} />
          </SessionProvider>
        );
      });

      const emailInput = renderer!.root.findByProps({ accessibilityLabel: 'Email address' });
      let passwordInput = renderer!.root.findByProps({ accessibilityLabel: 'Password' });
      const toggleBtn = renderer!.root.findByProps({ accessibilityLabel: 'Show password' });

      expect(passwordInput.props.secureTextEntry).toBe(true);

      // Toggle show password
      await ReactTestRenderer.act(async () => {
        toggleBtn.props.onPress();
      });

      passwordInput = renderer!.root.findByProps({ accessibilityLabel: 'Password' });
      expect(passwordInput.props.secureTextEntry).toBe(false);

      await ReactTestRenderer.act(async () => {
        emailInput.props.onChangeText('u@vsis.lk');
        passwordInput.props.onChangeText('Secret123!');
      });

      await ReactTestRenderer.act(async () => {
        await passwordInput.props.onSubmitEditing();
      });

      expect(mockSignIn).toHaveBeenCalledWith({ email: 'u@vsis.lk', password: 'Secret123!' });
    });
  });

  describe('Icon Component Uniformity & Optical Scaling', () => {
    it('renders clock and navigation peer icons with consistent container sizing', () => {
      let renderer: ReactTestRenderer.ReactTestRenderer;

      ReactTestRenderer.act(() => {
        renderer = ReactTestRenderer.create(
          <>
            <Icon color="#000" name="clock" size={24} />
            <Icon color="#000" name="home" size={24} />
            <Icon color="#000" name="reports" size={24} />
            <Icon color="#000" name="more" size={24} />
          </>
        );
      });

      const views = renderer!.root.findAllByType('View' as React.ElementType);
      expect(views).toHaveLength(4);

      for (const v of views) {
        const flatStyle = Object.assign({}, ...[v.props.style].flat());
        expect(flatStyle.width).toBe(24);
        expect(flatStyle.height).toBe(24);
      }
    });
  });
});
