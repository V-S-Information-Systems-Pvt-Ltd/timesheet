import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * Hook to handle Android hardware back button events.
 *
 * @param onBack Callback function executed when hardware back button is pressed.
 *               Return `true` to consume the back event (prevent exiting the app),
 *               or `false`/`void` to let default behavior continue.
 */
export function useAndroidBackHandler(onBack: () => boolean | void) {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const result = onBack();
      return typeof result === 'boolean' ? result : true;
    });

    return () => subscription.remove();
  }, [onBack]);
}
