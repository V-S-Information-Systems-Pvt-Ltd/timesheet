import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TimesheetEntry } from '../api/contracts';
import { colors, spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import { Icon } from './Icon';

interface TimesheetEntryCardProps {
  entry: TimesheetEntry;
  isDeleting?: boolean;
  canDelete?: boolean;
  onDelete?: (entry: TimesheetEntry) => void;
  palette: Palette;
}

export const TimesheetEntryCard = React.memo(function TimesheetEntryCardComponent({
  entry,
  isDeleting = false,
  canDelete = false,
  onDelete,
  palette,
}: TimesheetEntryCardProps) {
  const statusLower = (entry.status || '').toLowerCase();
  let statusColor = palette.muted;
  let statusBg = palette.badgeBg;

  if (statusLower === 'approved') {
    statusColor = colors.success;
    statusBg = palette.successBoxBg;
  } else if (statusLower === 'rejected') {
    statusColor = colors.error;
    statusBg = palette.errorBoxBg;
  } else if (statusLower === 'pending' || statusLower === 'submitted') {
    statusColor = colors.warning;
    statusBg = palette.warningBoxBg;
  }

  return (
    <View
      style={[
        styles.entryCard,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      {/* Top Header: Date, Hours, Delete */}
      <View style={styles.entryHeader}>
        <View style={styles.entryHeaderLeft}>
          <Text style={[styles.entryDate, { color: palette.foreground }]}>
            {entry.log_date}
          </Text>
          {entry.status ? (
            <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
              <Text style={[styles.statusText, { color: statusColor }]}>
                {entry.status.toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>

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
                <Icon color={colors.error} name="trash" size={16} />
              )}
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Project & Activity Badges */}
      {(entry.project_name || entry.activity_name) ? (
        <View style={styles.tagRow}>
          {entry.project_name ? (
            <View style={[styles.projectTag, { backgroundColor: palette.badgeBg }]}>
              <Icon color={colors.primary} name="folder" size={12} style={styles.tagIcon} />
              <Text numberOfLines={1} style={[styles.projectTagText, { color: colors.primary }]}>
                {entry.project_name}
              </Text>
            </View>
          ) : null}
          {entry.activity_name ? (
            <View style={[styles.activityTag, { borderColor: palette.border, backgroundColor: palette.card }]}>
              <Icon color={palette.muted} name="tag" size={12} style={styles.tagIcon} />
              <Text numberOfLines={1} style={[styles.activityTagText, { color: palette.muted }]}>
                {entry.activity_name}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Work Done / Notes Description */}
      {entry.work_done || entry.notes ? (
        <Text numberOfLines={3} style={[styles.entryNotes, { color: palette.foreground }]}>
          {entry.work_done || entry.notes}
        </Text>
      ) : null}
    </View>
  );
});

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
  entryHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
    marginRight: spacing.sm,
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
  statusBadge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: borderRadius.xs,
  },
  statusText: {
    fontSize: typography.badge,
    fontWeight: '800',
    letterSpacing: 0.5,
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
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButtonText: {
    color: colors.error,
    fontSize: typography.body,
    fontWeight: '700',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
    alignItems: 'center',
  },
  tagIcon: {
    marginRight: 4,
  },
  projectTag: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    maxWidth: '65%',
  },
  projectTagText: {
    fontSize: typography.badge,
    fontWeight: '700',
  },
  activityTag: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    maxWidth: '35%',
  },
  activityTagText: {
    fontSize: typography.badge,
    fontWeight: '600',
  },
  entryNotes: {
    fontSize: typography.caption,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
});
