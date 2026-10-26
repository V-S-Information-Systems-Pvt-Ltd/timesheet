import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TimesheetEntry } from '../api/contracts';
import { fonts, numeralSizes, spacing, typography, borderRadius, type Palette } from '../theme';
import { formatDatePreview } from '../utils/dates';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { activityDisplayLabel } from '@vsis/contracts';

// Screen-reader hint in the platform's own input vocabulary: Windows users click, not tap.
const ENTRY_HINT = Platform.OS === 'windows'
  ? 'Click to edit, press and hold to select'
  : 'Double tap to edit, long press to select';

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
  /** Tapping the card body opens the entry. Without it the card is inert. */
  onPress?: (entry: TimesheetEntry) => void;
  /** Long press enters selection mode; the explicit Select button stays. */
  onLongPress?: (entry: TimesheetEntry) => void;
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
  onPress,
  onLongPress,
  palette,
}: TimesheetEntryCardProps) {
  // `log_date` stays ISO everywhere it is data; only what a person reads is
  // rendered as a date. formatDatePreview echoes its input when unparseable.
  const displayDate = formatDatePreview(entry.log_date);
  const interactive = Boolean(onPress || onLongPress);
  const activityLabel = entry.entry_type && entry.activity_code
    ? activityDisplayLabel(entry.entry_type, entry.activity_code)
    : entry.activity_name ? `Legacy · ${entry.activity_name}` : 'Legacy';

  /**
   * The card is one accessibility element when it is pressable, which groups
   * its children on iOS. Every per-entry action is therefore also exposed as an
   * accessibility action, so nothing becomes unreachable without a long press.
   */
  const accessibilityActions = interactive
    ? [
        ...(onToggleSelect
          ? [
              {
                name: isSelected ? 'deselect' : 'select',
                label: isSelected ? 'Deselect entry' : 'Select entry',
              },
            ]
          : []),
        ...(canEdit && onEdit ? [{ name: 'edit', label: 'Edit entry' }] : []),
        ...(canDuplicate && onDuplicate ? [{ name: 'duplicate', label: 'Duplicate entry' }] : []),
        ...(canDelete && onDelete ? [{ name: 'delete', label: 'Delete entry' }] : []),
      ]
    : undefined;

  const handleAccessibilityAction = (event: { nativeEvent: { actionName: string } }) => {
    switch (event.nativeEvent.actionName) {
      case 'select':
      case 'deselect':
        onToggleSelect?.(entry);
        break;
      case 'edit':
        onEdit?.(entry);
        break;
      case 'duplicate':
        onDuplicate?.(entry);
        break;
      case 'delete':
        onDelete?.(entry);
        break;
      default:
        break;
    }
  };

  const cardBody = (
    <>
      {isSelectionMode ? (
        <Pressable
          accessibilityLabel={`Select entry on ${displayDate}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => onToggleSelect?.(entry)}
          style={styles.checkboxHitArea}
        >
          {/* The box stays 22px; the pressable around it carries the target. */}
          <View
            style={[
              styles.checkbox,
              {
                borderColor: isSelected ? palette.primary : palette.controlBorder,
                backgroundColor: isSelected ? palette.primary : palette.sheet,
              },
            ]}
          >
            {isSelected ? <Icon color={palette.onPrimary} name="check" size={12} /> : null}
          </View>
        </Pressable>
      ) : null}

      {/* Ledger: hours first, so a column of entries reads as a column of numbers. */}
      <View style={styles.hoursColumn}>
        <Text style={[styles.hoursText, { color: palette.foreground }]}>
          {Number(entry.hours_worked).toFixed(1)}
        </Text>
        <Text style={[styles.hoursUnit, { color: palette.muted }]}>hrs</Text>
      </View>

      <View style={styles.body}>
        <Text style={[styles.entryDate, { color: palette.foreground }]}>{displayDate}</Text>
        {entry.user_email ? (
          <Text numberOfLines={1} style={[styles.userEmail, { color: palette.muted }]}>
            {entry.user_email}
          </Text>
        ) : null}
        {entry.project_name ? (
          <Text numberOfLines={1} style={[styles.project, { color: palette.foreground }]}>
            {entry.project_name}
          </Text>
        ) : null}
        {activityLabel ? (
          <Text numberOfLines={1} style={[styles.activity, { color: palette.muted }]}>
            {activityLabel}
          </Text>
        ) : null}
        {entry.ticket_number ? <Text style={[styles.entryNotes, { color: palette.foreground }]}>Ticket Number: {entry.ticket_number}</Text> : null}
        {entry.activity_other ? <Text style={[styles.entryNotes, { color: palette.foreground }]}>Other Activity: {entry.activity_other}</Text> : null}
        {entry.work_done ? (
          <Text numberOfLines={3} style={[styles.entryNotes, { color: palette.foreground }]}>
            {entry.work_done}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {!isSelectionMode && canDuplicate && onDuplicate ? (
          <Pressable
            accessibilityLabel={`Duplicate entry on ${displayDate}`}
            accessibilityRole="button"
            disabled={isDuplicating}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => onDuplicate(entry)}
            style={styles.actionButton}
          >
            {isDuplicating ? (
              <ActivityIndicator color={palette.primary} size="small" />
            ) : (
              <Icon color={palette.primaryText} name="plus" size={16} />
            )}
          </Pressable>
        ) : null}

        {!isSelectionMode && canEdit && onEdit ? (
          <Pressable
            accessibilityLabel={`Edit entry on ${displayDate}`}
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
            accessibilityLabel={`Delete entry on ${displayDate}`}
            accessibilityRole="button"
            disabled={isDeleting}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => onDelete(entry)}
            style={[styles.actionButton, styles.deleteActionButton]}
          >
            {isDeleting ? (
              <ActivityIndicator color={palette.missingText} size="small" />
            ) : (
              <Icon color={palette.missingText} name="trash" size={16} />
            )}
          </Pressable>
        ) : null}
      </View>
    </>
  );

  const cardStyle = [
    styles.row,
    {
      backgroundColor: isSelected ? palette.badgeBg : 'transparent',
      borderBottomColor: palette.hairline,
    },
  ];

  if (!interactive) {
    return <View style={cardStyle}>{cardBody}</View>;
  }

  return (
    <PressableScale
      accessibilityActions={accessibilityActions}
      accessibilityHint={onPress ? ENTRY_HINT : undefined}
      accessibilityLabel={`Entry on ${displayDate}, ${Number(entry.hours_worked).toFixed(1)} hours${
        entry.project_name ? `, ${entry.project_name}` : ''
      }, ${activityLabel}${entry.ticket_number ? `, Ticket Number: ${entry.ticket_number}` : ''}${entry.activity_other ? `, Other Activity: ${entry.activity_other}` : ''}`}
      accessibilityRole="button"
      accessibilityState={isSelectionMode ? { selected: isSelected } : undefined}
      onAccessibilityAction={handleAccessibilityAction}
      onLongPress={onLongPress ? () => onLongPress(entry) : undefined}
      onPress={onPress ? () => onPress(entry) : undefined}
      scaleTo={1}
      style={[cardStyle, styles.rowPressable]}
    >
      {cardBody}
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  // Ledger row: no box, a hairline underneath.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // PressableScale centres its children unless the layout says otherwise; a
  // row's content is full-width and top-aligned.
  rowPressable: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  checkboxHitArea: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: borderRadius.xs,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hoursColumn: {
    width: 56,
    alignItems: 'flex-start',
  },
  hoursText: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.md,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    lineHeight: 30,
  },
  hoursUnit: {
    fontSize: typography.badge,
  },
  body: {
    flex: 1,
    marginRight: spacing.sm,
  },
  entryDate: {
    fontSize: typography.body,
    fontWeight: '600',
  },
  userEmail: {
    fontSize: typography.caption,
  },
  project: {
    fontSize: typography.body,
    marginTop: 2,
  },
  activity: {
    fontSize: typography.caption,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: spacing.xs,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Keeps the destructive action apart from edit so a mouse click can't hit it by accident.
  deleteActionButton: {
    marginLeft: spacing.md,
  },
  entryNotes: {
    fontSize: typography.caption,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
});
