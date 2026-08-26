import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';

import { SessionProvider, useSession } from '../src/auth/SessionProvider';
import { fakeClient, fakeController, signedInState } from '../src/test-support';
import type { SessionState } from '../src/auth/session-controller';

let seen: SessionState | null = null;

function Probe() {
  const { state, controller } = useSession();
  seen = state;
  return (
    <Text onPress={() => void controller.restore()}>
      {state.status}
    </Text>
  );
}

describe('SessionProvider', () => {
  it('exposes the current session state to consumers', async () => {
    const controller = fakeController(signedInState());
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider client={fakeClient()} controller={controller} autoRestore={false}>
          <Probe />
        </SessionProvider>,
      );
    });

    expect(seen).toMatchObject({ status: 'signed-in' });
    expect(renderer.root.findByProps({ children: 'signed-in' })).toBeTruthy();
  });

  it('boots the cold-start restore exactly once when autoRestore is on', async () => {
    const restore = jest.fn().mockResolvedValue(signedInState());
    const controller = fakeController({ status: 'booting' }, { restore });
    let renderer!: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider client={fakeClient()} controller={controller}>
          <Probe />
        </SessionProvider>,
      );
    });
    await ReactTestRenderer.act(async () => {
      renderer.update(
        <SessionProvider client={fakeClient()} controller={controller}>
          <Probe />
        </SessionProvider>,
      );
    });

    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('propagates controller state updates to subscribers', async () => {
    const controller = fakeController({ status: 'booting' });

    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(
        <SessionProvider client={fakeClient()} controller={controller}>
          <Probe />
        </SessionProvider>,
      );
    });
    expect(seen).toMatchObject({ status: 'booting' });

    await ReactTestRenderer.act(async () => {
      (controller as unknown as { emit: (next: SessionState) => void }).emit({
        status: 'offline',
        baseUrl: null,
        message: 'unreachable',
      });
    });

    expect(seen).toMatchObject({ status: 'offline' });
  });
});
