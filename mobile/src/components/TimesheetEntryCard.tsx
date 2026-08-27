import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TimesheetEntry } from '../api/contracts';
import { colors, spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import { Icon } from './Icon';

export interface TimesheetEntryCardProps {
  entry: TimesheetEntry;
  isDeleting?: boolean;
  canDelete?: boolean;
  onDelete?: (entry: TimesheetEntry) => void;
  canEdit?: boolean;
  onEdit?: (entry: TimesheetEntry) => void;
  canDuplicate?: boolean;
  isDuplicating?: boolean;
  onDuplicate?: (entry: TimesheetEntry) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (entry: TimesheetEntry) => void;
  palette: Palette;
}

export const TimesheetEntryCard = React.memo(function TimesheetEntryCardComponent({
  entry,
  isDeleting = false,
  canDelete = false,
  onDelete,
  canEdit = false,
  onEdit,
  canDuplicate = false,
  isDuplicating = false,
  onDuplicate,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
  palette,
}: TimesheetEntryCardProps) {
  return (
    <View
      style={[
        styles.entryCard,
        {
          backgroundColor: isSelected ? palette.badgeBg : palette.card,
          borderColor: isSelected ? colors.primary : palette.border,
        },
      ]}
    >
      {/* Top Header: Date, Hours, Actions */}
      <View style={styles.entryHeader}>
        <View style={styles.entryHeaderLeft}>
          {isSelectionMode ? (
            <Pressable
              accessibilityLabel={`Select entry on ${entry.log_date}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => onToggleSelect?.(entry)}
              style={[
                styles.checkbox,
                {
                  borderColor: isSelected ? colors.primary : palette.border,
                  backgroundColor: isSelected ? colors.primary : palette.card,
                },
              ]}
            >
              {isSelected ? <Icon color={colors.onPrimary} name="check" size={12} /> : null}
            </Pressable>
          ) : null}

          <Text style={[styles.entryDate, { color: palette.foreground }]}>
            {entry.log_date}
          </Text>
          {entry.user_email ? (
            <Text numberOfLines={1} style={[styles.userEmail, { color: palette.muted }]}>
              {entry.user_email}
            </Text>
          ) : null}
        </View>

        <View style={styles.entryHeaderRight}>
          <View style={[styles.hoursBadge, { backgroundColor: palette.badgeBg }]}>
            <Text style={styles.hoursText}>
              {Number(entry.hours_worked).toFixed(1)} hrs
            </Text>
          </View>

          {!isSelectionMode && canDuplicate && onDuplicate ? (
            <Pressable
              accessibilityLabel={`Duplicate entry on ${entry.log_date}`}
              accessibilityRole="button"
              disabled={isDuplicating}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => onDuplicate(entry)}
              style={styles.actionButton}
            >
              {isDuplicating ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Icon color={colors.primary} name="plus" size={16} />
              )}
            </Pressable>
          ) : null}

          {!isSelectionMode && canEdit && onEdit ? (
            <Pressable
              accessibilityLabel={`Edit entry on ${entry.log_date}`}
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => onEdit(entry)}
              style={styles.actionButton}
            >
              <Icon color={palette.foreground} name="edit" size={16} />
            </Pressable>
          ) : null}

          {!isSelectionMode && canDelete && onDelete ? (
            <Pressable
              accessibilityLabel={`Delete entry on ${entry.log_date}`}
              accessibilityRole="button"
              disabled={isDeleting}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => onDelete(entry)}
              style={styles.actionButton}
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

      {/* Work Done Description */}
      {entry.work_done ? (
        <Text numberOfLines={3} style={[styles.entryNotes, { color: palette.foreground }]}>
          {entry.work_done}
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
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: borderRadius.xs,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  userEmail: {
    fontSize: typography.caption,
    marginLeft: spacing.xs,
    flexShrink: 1,
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
  actionButton: {
    padding: spacing.xs,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
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
