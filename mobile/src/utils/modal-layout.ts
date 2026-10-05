import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';

export function modalBounds(width: number, height: number, maxWidth: number, maxHeight: number): ViewStyle {
  return {
    flex: 0,
    width: Math.min(Math.floor(width * 0.9), maxWidth),
    height: Math.min(Math.floor(height * 0.85), maxHeight),
  };
}

// RNW sizes native modal windows from their children. An unconstrained flex
// container can grow to the entire list's height instead of providing a viewport.
export function useModalBounds(maxWidth = 640, maxHeight = 700): ViewStyle {
  const { width, height } = useWindowDimensions();
  return Platform.OS === 'windows' ? modalBounds(width, height, maxWidth, maxHeight) : {};
}
