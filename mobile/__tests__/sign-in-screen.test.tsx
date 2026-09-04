import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Linking } from 'react-native';
import { SignInScreen } from '../src/screens/SignInScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('SignInScreen', () => {
  it('offers a browser password-reset handoff for the configured workspace', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        login: jest.fn(),
      } as unknown as ApiClient;
    });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={new MemoryTokenStore()}>
          <SignInScreen isDarkMode={false} onBackToConnect={jest.fn()} />
        </SessionProvider>
      );
    });

    const forgot = renderer!.root.findByProps({ accessibilityLabel: 'Forgot password' });
    await ReactTestRenderer.act(async () => {
      await forgot.props.onPress();
    });
    expect(openURL).toHaveBeenCalledWith('https://timesheet.example.com/forgot-password');
    openURL.mockRestore();
  });

  it('displays an error if opening the browser fails', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('Browser open failed'));
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        login: jest.fn(),
      } as unknown as ApiClient;
    });

    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={new MemoryTokenStore()}>
          <SignInScreen isDarkMode={false} onBackToConnect={jest.fn()} />
        </SessionProvider>
      );
    });

    const forgot = renderer!.root.findByProps({ accessibilityLabel: 'Forgot password' });
    await ReactTestRenderer.act(async () => {
      await forgot.props.onPress();
    });
    expect(openURL).toHaveBeenCalledWith('https://timesheet.example.com/forgot-password');
    expect(renderer!.root.findAllByProps({ children: 'Unable to open the password reset page.' }).length).toBeGreaterThan(0);
    openURL.mockRestore();
  });

  it('renders email and password inputs and triggers validation on empty submit', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        login: jest.fn(),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <SignInScreen isDarkMode={false} onBackToConnect={onBack} />
        </SessionProvider>
      );
    });

    const emailInput = renderer!.root.findByProps({ accessibilityLabel: 'Email address' });
    const passwordInput = renderer!.root.findByProps({ accessibilityLabel: 'Password' });
    const submitBtn = renderer!.root.findByProps({ accessibilityLabel: 'Sign in button' });

    expect(emailInput).toBeDefined();
    expect(passwordInput).toBeDefined();

    // Submit with empty fields
    await ReactTestRenderer.act(async () => {
      await submitBtn.props.onPress();
    });

    const alert = renderer!.root.findByProps({ accessibilityRole: 'alert' });
    expect(alert).toBeDefined();
  });

  it('switches to register mode, validates short password, and submits registration', async () => {
    const mockSignup = jest.fn().mockResolvedValue({
      success: true,
      isActive: true,
      message: 'Account created and activated!',
    });

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        signup: mockSignup,
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

    // Switch to Register tab
    const registerTab = renderer!.root.findByProps({ accessibilityLabel: 'Switch to Register Account' });
    await ReactTestRenderer.act(async () => {
      registerTab.props.onPress();
    });

    let emailInput = renderer!.root.findByProps({ accessibilityLabel: 'Email address' });
    let passwordInput = renderer!.root.findByProps({ accessibilityLabel: 'Password' });
    let nameInput = renderer!.root.findByProps({ accessibilityLabel: 'Full Name' });
    let submitBtn = renderer!.root.findByProps({ accessibilityLabel: 'Create account button' });

    // Validate short password
    await ReactTestRenderer.act(async () => {
      emailInput.props.onChangeText('jane@company.com');
      nameInput.props.onChangeText('Jane Doe');
      passwordInput.props.onChangeText('short');
    });

    submitBtn = renderer!.root.findByProps({ accessibilityLabel: 'Create account button' });
    await ReactTestRenderer.act(async () => {
      await submitBtn.props.onPress();
    });

    expect(mockSignup).not.toHaveBeenCalled();

    // Valid password
    passwordInput = renderer!.root.findByProps({ accessibilityLabel: 'Password' });
    await ReactTestRenderer.act(async () => {
      passwordInput.props.onChangeText('ValidPassword123!');
    });

    submitBtn = renderer!.root.findByProps({ accessibilityLabel: 'Create account button' });
    await ReactTestRenderer.act(async () => {
      await submitBtn.props.onPress();
    });

    expect(mockSignup).toHaveBeenCalledWith({
      email: 'jane@company.com',
      password: 'ValidPassword123!',
      name: 'Jane Doe',
    });
  });
});
