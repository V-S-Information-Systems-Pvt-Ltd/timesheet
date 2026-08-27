import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import { PressableScale } from './PressableScale';

export interface HubItem {
  key: string;
  icon: string;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}

interface FeatureHubProps {
  items: HubItem[];
  palette: Palette;
}

export function FeatureHub({ items, palette }: FeatureHubProps) {
  return (
    <View style={styles.hubContainer}>
      {items.map((item) => (
        <View key={item.key} style={items.length <= 3 ? styles.hubItemThree : styles.hubItemGrid}>
          <PressableScale
            accessibilityLabel={item.accessibilityLabel}
            accessibilityRole="button"
            onPress={item.onPress}
            style={[
              styles.hubButton,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            <View style={[styles.iconBadge, { backgroundColor: palette.badgeBg }]}>
              <Text style={styles.hubIcon}>{item.icon}</Text>
            </View>
            <Text numberOfLines={1} style={[styles.hubLabel, { color: palette.foreground }]}>
              {item.label}
            </Text>
          </PressableScale>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hubContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  hubItemThree: {
    flex: 1,
    minWidth: '28%',
  },
  hubItemGrid: {
    width: '48%',
    flexGrow: 1,
  },
  hubButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 74,
    ...shadows.sm,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  hubIcon: {
    fontSize: 20,
  },
  hubLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    textAlign: 'center',
  },
});
