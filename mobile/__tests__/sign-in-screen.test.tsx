import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SignInScreen } from '../src/screens/SignInScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('SignInScreen', () => {
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
});
