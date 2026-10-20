import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { spacing, typography, borderRadius, type Palette } from '../theme';

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
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      onPress={onPress}
      style={[
        styles.tab,
        active
          ? [styles.activeTab, { backgroundColor: palette.foreground, borderColor: palette.foreground }]
          : [styles.inactiveTab, { backgroundColor: 'transparent', borderColor: palette.controlBorder }],
      ]}
    >
      <Text
        style={[
          styles.tabText,
          { color: active ? palette.paper : palette.muted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tab: {
    borderRadius: borderRadius.full,
    borderWidth: 1,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    minHeight: 38,
  },
  activeTab: {
    borderWidth: 1,
  },
  inactiveTab: {},
  tabText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
});
