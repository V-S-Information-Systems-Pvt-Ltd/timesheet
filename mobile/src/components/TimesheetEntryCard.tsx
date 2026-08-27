import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TimesheetEntry } from '../api/contracts';
import { colors, spacing, typography, borderRadius, shadows, type Palette } from '../theme';

interface TimesheetEntryCardProps {
  entry: TimesheetEntry;
  isDeleting?: boolean;
  canDelete?: boolean;
  onDelete?: (entry: TimesheetEntry) => void;
  palette: Palette;
}

export function TimesheetEntryCard({
  entry,
  isDeleting = false,
  canDelete = false,
  onDelete,
  palette,
}: TimesheetEntryCardProps) {
  return (
    <View
      style={[
        styles.entryCard,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      <View style={styles.entryHeader}>
        <Text style={[styles.entryDate, { color: palette.foreground }]}>
          {entry.log_date}
        </Text>
        <View style={styles.entryHeaderRight}>
          <View style={[styles.hoursBadge, { backgroundColor: palette.badgeBg }]}>
            <Text style={styles.hoursText}>
              {Number(entry.hours_worked).toFixed(1)} hrs
            </Text>
          </View>
          {canDelete && onDelete ? (
            <Pressable
              accessibilityLabel={`Delete entry on ${entry.log_date}`}
              accessibilityRole="button"
              disabled={isDeleting}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              onPress={() => onDelete(entry)}
              style={styles.deleteButton}
            >
              {isDeleting ? (
                <ActivityIndicator color={colors.error} size="small" />
              ) : (
                <Text style={styles.deleteButtonText}>✕</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
      {entry.work_done || entry.notes ? (
        <Text numberOfLines={2} style={[styles.entryNotes, { color: palette.muted }]}>
          {entry.work_done || entry.notes}
        </Text>
      ) : null}
      {entry.status ? (
        <View style={styles.entryFooter}>
          <Text style={[styles.statusText, { color: palette.muted }]}>
            Status: {entry.status}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  entryCard: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  entryHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  entryDate: {
    fontSize: typography.body,
    fontWeight: '700',
  },
  hoursBadge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.xs,
  },
  hoursText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  deleteButton: {
    padding: spacing.xs,
  },
  deleteButtonText: {
    color: colors.error,
    fontSize: typography.body,
    fontWeight: '700',
  },
  entryNotes: {
    fontSize: typography.caption,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  entryFooter: {
    marginTop: spacing.xs,
  },
  statusText: {
    fontSize: typography.caption,
  },
});
