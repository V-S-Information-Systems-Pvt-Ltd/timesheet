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
        <PressableScale
          key={item.key}
          accessibilityLabel={item.accessibilityLabel}
          accessibilityRole="button"
          onPress={item.onPress}
          style={[
            styles.hubButton,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <Text style={styles.hubIcon}>{item.icon}</Text>
          <Text style={[styles.hubLabel, { color: palette.foreground }]}>
            {item.label}
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hubContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  hubButton: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  hubIcon: {
    fontSize: 22,
    marginBottom: spacing.xs,
  },
  hubLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    textAlign: 'center',
  },
});
