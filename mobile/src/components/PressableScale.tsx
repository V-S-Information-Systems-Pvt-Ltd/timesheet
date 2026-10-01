import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
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
  const layout = StyleSheet.flatten(style);
  const scale = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    try {
      if (typeof AccessibilityInfo?.isReduceMotionEnabled === 'function') {
        AccessibilityInfo.isReduceMotionEnabled()
          .then((enabled) => {
            if (mounted) setReduceMotion(Boolean(enabled));
          })
          .catch(() => {});
      }

      const sub =
        typeof AccessibilityInfo?.addEventListener === 'function'
          ? AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
              if (mounted) setReduceMotion(Boolean(enabled));
            })
          : undefined;

      return () => {
        mounted = false;
        try {
          if (sub && typeof sub.remove === 'function') {
            sub.remove();
          }
        } catch {
          // ignore
        }
      };
    } catch {
      return () => {
        mounted = false;
      };
    }
  }, []);

  useEffect(() => {
    return () => {
      try {
        scale.stopAnimation();
      } catch {
        // ignore
      }
    };
  }, [scale]);

  const isNativeDriverSupported =
    Platform.OS === 'android' || Platform.OS === 'ios';

  const handlePressIn = (e: any) => {
    if (!disabled && !reduceMotion) {
      try {
        Animated.spring(scale, {
          toValue: scaleTo,
          useNativeDriver: isNativeDriverSupported,
          speed: 50,
          bounciness: 4,
        }).start();
      } catch {
        // ignore
      }
    }
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    if (!disabled && !reduceMotion) {
      try {
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: isNativeDriverSupported,
          speed: 50,
          bounciness: 4,
        }).start();
      } catch {
        // ignore
      }
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
      style={style}
      {...rest}
    >
      <Animated.View style={[
        styles.innerContent,
        {
          flexDirection: layout?.flexDirection,
          flexWrap: layout?.flexWrap,
          alignItems: layout?.alignItems ?? 'center',
          justifyContent: layout?.justifyContent ?? 'center',
          gap: layout?.gap,
          rowGap: layout?.rowGap,
          columnGap: layout?.columnGap,
          transform: [{ scale }],
        },
      ]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  innerContent: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
