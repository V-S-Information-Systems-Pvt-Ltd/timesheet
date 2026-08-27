import React, { useRef } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  rippleColor?: string;
  children: React.ReactNode;
}

export function PressableScale({
  children,
  style,
  scaleTo = 0.97,
  rippleColor,
  disabled,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const isNativeDriverSupported =
    Platform.OS !== 'web' &&
    (typeof (globalThis as any).process === 'undefined' ||
      (globalThis as any).process?.env?.NODE_ENV !== 'test');

  const handlePressIn = (e: any) => {
    if (!disabled) {
      Animated.spring(scale, {
        toValue: scaleTo,
        useNativeDriver: isNativeDriverSupported,
        speed: 50,
        bounciness: 4,
      }).start();
    }
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    if (!disabled) {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: isNativeDriverSupported,
        speed: 50,
        bounciness: 4,
      }).start();
    }
    onPressOut?.(e);
  };

  const androidRipple = Platform.OS === 'android'
    ? {
        color: rippleColor || 'rgba(0, 0, 0, 0.08)',
        borderless: false,
      }
    : undefined;

  return (
    <Pressable
      android_ripple={androidRipple}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
