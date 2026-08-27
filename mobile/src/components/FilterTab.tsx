import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, spacing, typography, borderRadius, type Palette } from '../theme';

interface FilterTabProps {
  label: string;
  accessibilityLabel?: string;
  active: boolean;
  onPress: () => void;
  palette: Palette;
}

export function FilterTab({
  label,
  accessibilityLabel,
  active,
  onPress,
  palette,
}: FilterTabProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? `Filter: ${label}`}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.tab,
        active
          ? styles.activeTab
          : [styles.inactiveTab, { backgroundColor: palette.card, borderColor: palette.border }],
      ]}
    >
      <Text
        style={[
          styles.tabText,
          { color: active ? colors.onPrimary : palette.muted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tab: {
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    minHeight: 38,
  },
  activeTab: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  inactiveTab: {},
  tabText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
