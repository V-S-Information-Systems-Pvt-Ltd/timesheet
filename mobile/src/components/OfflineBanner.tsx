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
import type { QueuedOfflineMutation } from '../storage/offline-queue';

export interface OfflineBannerProps {
  isOffline: boolean;
  pendingCount: number;
  failedCount?: number;
  failedItems?: QueuedOfflineMutation[];
  isSyncing: boolean;
  onSync: () => void;
  onRetryItem?: (id: string) => void;
  onDiscardItem?: (id: string) => void;
  palette: Palette;
}

export function OfflineBanner({
  isOffline,
  pendingCount,
  failedCount = 0,
  failedItems = [],
  isSyncing,
  onSync,
  onRetryItem,
  onDiscardItem,
  palette,
}: OfflineBannerProps) {
  if (!isOffline && pendingCount === 0 && failedCount === 0 && !isSyncing) {
    return null;
  }

  let text = '';
  if (isOffline) {
    const parts = ['Working offline'];
    if (pendingCount > 0) parts.push(`${pendingCount} queued`);
    if (failedCount > 0) parts.push(`${failedCount} failed`);
    text = parts.join(' • ');
  } else if (isSyncing) {
    text = `Syncing changes... (${pendingCount} remaining)`;
  } else if (failedCount > 0) {
    text = `${failedCount} sync item${failedCount > 1 ? 's' : ''} failed`;
  } else {
    text = `${pendingCount} changes pending sync`;
  }

  const hasFailedItems = failedCount > 0 && failedItems.length > 0;
  const isErrorColor = failedCount > 0 && !isOffline;

  return (
    <View style={styles.container}>
      <View
        accessibilityRole="alert"
        style={[
          styles.banner,
          {
            backgroundColor: isOffline ? palette.badgeBg : isErrorColor ? colors.error : palette.primary,
            borderBottomColor: palette.border,
          },
        ]}
      >
        <View style={styles.textContainer}>
          <View
            style={[
              styles.dot,
              { backgroundColor: isOffline || isErrorColor ? colors.error : palette.onPrimary },
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

      {hasFailedItems ? (
        <View style={[styles.failedContainer, { backgroundColor: palette.card, borderColor: palette.border }]}>
          {failedItems.map((item) => (
            <View key={item.id} style={[styles.failedItem, { borderBottomColor: palette.border }]}>
              <View style={styles.failedItemInfo}>
                <Text style={[styles.failedItemType, { color: palette.foreground }]}>
                  {item.type.replace('_', ' ').toUpperCase()}
                </Text>
                {item.lastError ? (
                  <Text style={[styles.failedItemError, { color: colors.error }]}>
                    {item.lastError}
                  </Text>
                ) : null}
              </View>
              <View style={styles.failedItemActions}>
                {onRetryItem && !item.lastError?.toLowerCase().includes('already completed') && !item.lastError?.includes('IDEMPOTENCY_COMMIT_UNKNOWN') ? (
                  <Pressable
                    accessibilityLabel={`Retry ${item.type}`}
                    accessibilityRole="button"
                    onPress={() => onRetryItem(item.id)}
                    style={[styles.itemActionBtn, { backgroundColor: palette.primary }]}
                  >
                    <Text style={[styles.itemActionBtnText, { color: palette.onPrimary }]}>Retry</Text>
                  </Pressable>
                ) : null}
                {onDiscardItem ? (
                  <Pressable
                    accessibilityLabel={`Discard ${item.type}`}
                    accessibilityRole="button"
                    onPress={() => onDiscardItem(item.id)}
                    style={[styles.itemActionBtn, { backgroundColor: colors.error }]}
                  >
                    <Text style={[styles.itemActionBtnText, { color: '#ffffff' }]}>Discard</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
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
  failedContainer: {
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  failedItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  failedItemInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  failedItemType: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  failedItemError: {
    fontSize: typography.badge,
    marginTop: 2,
  },
  failedItemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  itemActionBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.xs,
  },
  itemActionBtnText: {
    fontSize: typography.badge,
    fontWeight: '700',
  },
});
