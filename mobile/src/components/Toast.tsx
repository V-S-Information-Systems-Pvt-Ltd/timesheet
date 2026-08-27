import React, { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import { Icon } from './Icon';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type?: ToastType;
  visible: boolean;
  onDismiss: () => void;
  durationMs?: number;
  palette: Palette;
}

export function Toast({
  message,
  type = 'success',
  visible,
  onDismiss,
  durationMs = 3000,
  palette,
}: ToastProps) {
  const translateY = useRef(new Animated.Value(-60)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const isNativeDriverSupported =
    Platform.OS !== 'web' &&
    (typeof (globalThis as any).process === 'undefined' ||
      (globalThis as any).process?.env?.NODE_ENV !== 'test');

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 250,
          useNativeDriver: isNativeDriverSupported,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: isNativeDriverSupported,
        }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -60,
            duration: 200,
            useNativeDriver: isNativeDriverSupported,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: isNativeDriverSupported,
          }),
        ]).start(() => {
          onDismiss();
        });
      }, durationMs);

      return () => clearTimeout(timer);
    }
  }, [visible, durationMs, onDismiss, opacity, translateY, isNativeDriverSupported]);

  if (!visible) return null;

  const bgStyle =
    type === 'success'
      ? { backgroundColor: palette.successBoxBg, borderColor: colors.success }
      : type === 'error'
      ? { backgroundColor: palette.errorBoxBg, borderColor: colors.error }
      : { backgroundColor: palette.card, borderColor: palette.border };

  const textStyle =
    type === 'success'
      ? { color: colors.success }
      : type === 'error'
      ? { color: colors.error }
      : { color: palette.foreground };

  const iconName = type === 'success' ? 'check' : type === 'error' ? 'close' : 'clock';

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.container,
        bgStyle,
        {
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <Icon color={textStyle.color} name={iconName} size={16} style={styles.icon} />
      <Text style={[styles.message, textStyle]}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    flexDirection: 'row',
    left: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    position: 'absolute',
    right: spacing.lg,
    top: spacing.md,
    zIndex: 999,
    ...shadows.md,
  },
  icon: {
    fontSize: 16,
    fontWeight: '800',
    marginRight: spacing.sm,
  },
  message: {
    flex: 1,
    fontSize: typography.caption,
    fontWeight: '600',
  },
});
