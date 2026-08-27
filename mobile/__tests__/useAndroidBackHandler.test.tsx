import React from 'react';
import { BackHandler, Platform } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { useAndroidBackHandler } from '../src/platform/useAndroidBackHandler';

function TestComponent({ onBack }: { onBack: () => boolean | void }) {
  useAndroidBackHandler(onBack);
  return null;
}

describe('useAndroidBackHandler', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    (Platform as any).OS = originalOS;
    jest.restoreAllMocks();
  });

  test('registers hardwareBackPress listener on Android and invokes callback', async () => {
    (Platform as any).OS = 'android';
    let listener: (() => boolean | void) | null = null;
    const removeMock = jest.fn();

    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event: string, handler: any) => {
      if (event === 'hardwareBackPress') {
        listener = handler;
      }
      return { remove: removeMock } as any;
    });

    const onBack = jest.fn().mockReturnValue(true);
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<TestComponent onBack={onBack} />);
    });

    expect(BackHandler.addEventListener).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
    expect(listener).not.toBeNull();

    // Trigger back event
    const result = listener!();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);

    // Unmount
    await ReactTestRenderer.act(async () => {
      renderer!.unmount();
    });
    expect(removeMock).toHaveBeenCalled();
  });

  test('does not register listener on non-Android platforms', async () => {
    (Platform as any).OS = 'ios';
    const addListenerSpy = jest.spyOn(BackHandler, 'addEventListener');

    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(<TestComponent onBack={jest.fn()} />);
    });

    expect(addListenerSpy).not.toHaveBeenCalled();
  });
});
