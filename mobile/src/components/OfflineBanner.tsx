import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing, typography, borderRadius } from '../theme';
import type { Palette } from '../theme';

interface OfflineBannerProps {
  isOffline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  onSync: () => void;
  palette: Palette;
}

export function OfflineBanner({
  isOffline,
  pendingCount,
  isSyncing,
  onSync,
  palette,
}: OfflineBannerProps) {
  if (!isOffline && pendingCount === 0 && !isSyncing) {
    return null;
  }

  let text = '';
  if (isOffline) {
    text = pendingCount > 0 ? `Working offline • ${pendingCount} queued` : 'Working offline';
  } else if (isSyncing) {
    text = `Syncing changes... (${pendingCount} remaining)`;
  } else {
    text = `${pendingCount} changes pending sync`;
  }

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        {
          backgroundColor: isOffline ? palette.badgeBg : palette.primary,
          borderBottomColor: palette.border,
        },
      ]}
    >
      <View style={styles.textContainer}>
        <View
          style={[
            styles.dot,
            { backgroundColor: isOffline ? colors.error : palette.onPrimary },
          ]}
        />
        <Text
          style={[
            styles.bannerText,
            { color: isOffline ? palette.foreground : palette.onPrimary },
          ]}
        >
          {text}
        </Text>
      </View>

      {!isOffline && pendingCount > 0 ? (
        <Pressable
          accessibilityLabel="Sync pending changes now"
          accessibilityRole="button"
          disabled={isSyncing}
          onPress={onSync}
          style={styles.syncBtn}
        >
          {isSyncing ? (
            <ActivityIndicator color={palette.onPrimary} size="small" />
          ) : (
            <Text style={[styles.syncBtnText, { color: palette.onPrimary }]}>Sync Now</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    minHeight: 36,
  },
  textContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  bannerText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  syncBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.xs,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    minHeight: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  syncBtnText: {
    fontSize: typography.badge,
    fontWeight: '800',
  },
});
