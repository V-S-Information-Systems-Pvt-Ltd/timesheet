import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { ApiClientError } from '../src/api/client';
import { SignInScreen } from '../src/screens/SignInScreen';
import { fakeClient, fakeController, withSession } from '../src/test-support';
import type { SessionState } from '../src/auth/session-controller';

function findButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.find(
    (node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label,
  );
}

function textNodes(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll((node) => typeof node.props.children === 'string').map((node) => node.props.children as string);
}

describe('SignInScreen', () => {
  it('validates the form before calling signIn', async () => {
    const signIn = jest.fn().mockResolvedValue(undefined);
    const controller = fakeController({ status: 'signed-out', baseUrl: 'https://vsis.example' } as SessionState, { signIn });
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        withSession(controller, fakeClient(), <SignInScreen deviceName="test" />),
      );
    });

    await ReactTestRenderer.act(async () => {
      findButton(renderer, 'Sign in').props.onPress();
    });

    expect(signIn).not.toHaveBeenCalled();
    const strings = textNodes(renderer);
    expect(strings).toContain('Email is required.');
    expect(strings).toContain('Password is required.');
  });

  it('submits trimmed credentials and device metadata', async () => {
    const signIn = jest.fn().mockResolvedValue(undefined);
    const controller = fakeController({ status: 'signed-out', baseUrl: 'https://vsis.example' } as SessionState, { signIn });
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        withSession(controller, fakeClient(), <SignInScreen deviceName="Pixel 8" />),
      );
    });

    const emailInput = renderer.root.findByProps({ accessibilityLabel: 'Email' });
    const passwordInput = renderer.root.findByProps({ accessibilityLabel: 'Password' });

    await ReactTestRenderer.act(async () => {
      emailInput.props.onChangeText('user@example.com ');
      passwordInput.props.onChangeText('Sup3rSecret');
    });
    await ReactTestRenderer.act(async () => {
      findButton(renderer, 'Sign in').props.onPress();
    });

    expect(signIn).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'Sup3rSecret',
      deviceName: 'Pixel 8',
      platform: expect.any(String),
    });
  });

  it('maps INVALID_CREDENTIALS to neutral copy without revealing account existence', async () => {
    const error = new ApiClientError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    const signIn = jest.fn().mockRejectedValue(error);
    const controller = fakeController({ status: 'signed-out', baseUrl: null } as SessionState, { signIn });
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        withSession(controller, fakeClient(), <SignInScreen />),
      );
    });
    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ accessibilityLabel: 'Email' }).props.onChangeText('who-knows@example.com');
      renderer.root.findByProps({ accessibilityLabel: 'Password' }).props.onChangeText('whatever1');
    });
    await ReactTestRenderer.act(async () => {
      findButton(renderer, 'Sign in').props.onPress();
    });

    const strings = textNodes(renderer);
    expect(strings).toContain('Email or password is incorrect.');
  });

  it('explains pending approval when the actor is inactive', async () => {
    const controller = fakeController({ status: 'pending-approval' } as SessionState);
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        withSession(controller, fakeClient(), <SignInScreen />),
      );
    });

    const strings = textNodes(renderer).join('\n');
    expect(strings).toContain('not active yet');
  });

  it('toggles password visibility', async () => {
    const controller = fakeController({ status: 'signed-out', baseUrl: null } as SessionState);
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        withSession(controller, fakeClient(), <SignInScreen />),
      );
    });

    const toggle = findButton(renderer, 'Show password');
    expect(renderer.root.findByProps({ accessibilityLabel: 'Password' }).props.secureTextEntry).toBe(true);

    await ReactTestRenderer.act(async () => {
      toggle.props.onPress();
    });

    expect(renderer.root.findByProps({ accessibilityLabel: 'Hide password' })).toBeTruthy();
    expect(renderer.root.findByProps({ accessibilityLabel: 'Password' }).props.secureTextEntry).toBe(false);
  });
});
