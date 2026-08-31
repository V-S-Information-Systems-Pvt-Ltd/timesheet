import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SignInScreen } from '../src/screens/SignInScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');
jest.setTimeout(15000);

describe('Mobile workspace branding', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('renders custom workspace branding when provided by server config', async () => {
    const customBranding = {
      appName: 'Apex Software',
      primaryColor: '#0D9488',
      logoUrl: 'https://cdn.example.com/logo.png',
    };

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1,
          appVersion: '0.3.0',
          backend: 'native',
          capabilities: { bearerAuth: true, mobileApi: true },
          branding: customBranding,
        }),
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

    // Verify custom app name is rendered in uppercase
    const eyebrow = renderer!.root.findByProps({ children: 'APEX SOFTWARE' });
    expect(eyebrow).toBeDefined();

    // Verify logo image has the custom URI source
    const image = renderer!.root.findByProps({ accessibilityLabel: 'Apex Software' });
    expect(image.props.source).toEqual({ uri: 'https://cdn.example.com/logo.png' });
  });

  it('falls back to bundled VSIS branding on missing config or image error', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({
          apiVersion: 1,
          appVersion: '0.3.0',
          backend: 'native',
          capabilities: { bearerAuth: true, mobileApi: true },
        }),
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

    // Default branding is rendered
    const eyebrow = renderer!.root.findByProps({ children: 'VSIS TIMESHEET' });
    expect(eyebrow).toBeDefined();

    const image = renderer!.root.findByProps({ accessibilityLabel: 'VSIS Timesheet' });
    expect(image.props.source).toBeDefined();
  });
});
