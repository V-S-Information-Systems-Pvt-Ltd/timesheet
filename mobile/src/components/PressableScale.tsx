import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// Mouse users get hover feedback; touch platforms don't need it, and Windows
// already draws its own keyboard focus rectangle.
const showHover = Platform.OS === 'windows';

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
  onHoverIn,
  onHoverOut,
  ...rest
}: PressableScaleProps) {
  const layout = StyleSheet.flatten(style);
  const scale = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  const [hovered, setHovered] = useState(false);

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
      onHoverIn={(e) => { setHovered(true); onHoverIn?.(e); }}
      onHoverOut={(e) => { setHovered(false); onHoverOut?.(e); }}
      style={disabled ? [style, styles.disabled] : style}
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
      {showHover && hovered && !disabled ? (
        <View pointerEvents="none" style={[styles.hoverLayer, { borderRadius: layout?.borderRadius }]} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  innerContent: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A disabled control that looks identical to an enabled one is a dead end for
  // the user; dimming it is the visual signal, without a new dependency.
  disabled: {
    opacity: 0.5,
  },
  hoverLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(128, 128, 128, 0.14)',
  },
});
