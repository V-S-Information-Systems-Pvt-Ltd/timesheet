import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { spacing, typography, borderRadius, type Palette } from '../theme';
import { PressableScale } from './PressableScale';

interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'tab';
  disabled?: boolean;
  palette: Palette;
}

/** A pill choice. Selected = ink fill with paper text, as in the time entry form. */
export function Chip({
  label,
  active,
  onPress,
  accessibilityLabel,
  accessibilityRole = 'button',
  disabled = false,
  palette,
}: ChipProps) {
  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        disabled && styles.disabled,
        active
          ? { backgroundColor: palette.foreground, borderColor: palette.foreground }
          : { borderColor: palette.controlBorder },
      ]}
    >
      <Text numberOfLines={1} style={[styles.text, { color: active ? palette.paper : palette.foreground }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    maxWidth: 260,
  },
  text: { fontSize: typography.caption, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
