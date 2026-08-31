import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import { PressableScale } from './PressableScale';
import { Icon } from './Icon';
import { todayISO, addDaysISO, formatDatePreview, isValidISODate } from '../utils/dates';

export interface DateChooserModalProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  initialDate?: string;
  onConfirm: (targetDate: string) => Promise<void> | void;
  onCancel: () => void;
  isLoading?: boolean;
  palette: Palette;
}

export function DateChooserModal({
  visible,
  title,
  subtitle,
  initialDate,
  onConfirm,
  onCancel,
  isLoading = false,
  palette,
}: DateChooserModalProps) {
  const today = useMemo(() => todayISO(), []);
  const yesterday = useMemo(() => addDaysISO(today, -1), [today]);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate || today);
  const [customInput, setCustomInput] = useState<string>(initialDate || today);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      const defaultDate = initialDate || todayISO();
      setSelectedDate(defaultDate);
      setCustomInput(defaultDate);
      setValidationError(null);
    }
  }, [visible, initialDate]);

  const handleSelectQuickDate = useCallback((date: string) => {
    setSelectedDate(date);
    setCustomInput(date);
    setValidationError(null);
  }, []);

  const handleCustomDateChange = useCallback((text: string) => {
    setCustomInput(text);
    if (isValidISODate(text)) {
      setSelectedDate(text);
      setValidationError(null);
    } else {
      setValidationError('Please enter a valid date in YYYY-MM-DD format.');
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!isValidISODate(selectedDate)) {
      setValidationError('Please enter a valid date in YYYY-MM-DD format.');
      return;
    }
    await onConfirm(selectedDate);
  }, [selectedDate, onConfirm]);

  const formattedPreview = useMemo(() => {
    if (isValidISODate(selectedDate)) {
      return formatDatePreview(selectedDate);
    }
    return 'Invalid Date';
  }, [selectedDate]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={isLoading ? undefined : onCancel}
      transparent={true}
      visible={visible}
    >
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.safeContainer}>
          <View
            style={[
              styles.dialog,
              {
                backgroundColor: palette.card,
                borderColor: palette.border,
              },
            ]}
          >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: palette.border }]}>
              <View style={styles.headerTitles}>
                <Text style={[styles.title, { color: palette.foreground }]}>{title}</Text>
                {subtitle ? (
                  <Text style={[styles.subtitle, { color: palette.muted }]}>{subtitle}</Text>
                ) : null}
              </View>
              {!isLoading ? (
                <Pressable
                  accessibilityLabel="Close date chooser"
                  accessibilityRole="button"
                  onPress={onCancel}
                  style={styles.closeBtn}
                >
                  <Icon color={palette.muted} name="close" size={20} />
                </Pressable>
              ) : null}
            </View>

            {/* Quick shortcuts */}
            <View style={styles.body}>
              <Text style={[styles.sectionLabel, { color: palette.muted }]}>Quick Options</Text>
              <View style={styles.quickRow}>
                <PressableScale
                  accessibilityLabel="Choose today"
                  accessibilityRole="button"
                  disabled={isLoading}
                  onPress={() => handleSelectQuickDate(today)}
                  style={[
                    styles.quickChip,
                    {
                      backgroundColor: selectedDate === today ? palette.primary : palette.background,
                      borderColor: selectedDate === today ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.quickChipText,
                      { color: selectedDate === today ? colors.onPrimary : palette.foreground },
                    ]}
                  >
                    Today
                  </Text>
                </PressableScale>

                <PressableScale
                  accessibilityLabel="Choose yesterday"
                  accessibilityRole="button"
                  disabled={isLoading}
                  onPress={() => handleSelectQuickDate(yesterday)}
                  style={[
                    styles.quickChip,
                    {
                      backgroundColor: selectedDate === yesterday ? palette.primary : palette.background,
                      borderColor: selectedDate === yesterday ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.quickChipText,
                      { color: selectedDate === yesterday ? colors.onPrimary : palette.foreground },
                    ]}
                  >
                    Yesterday
                  </Text>
                </PressableScale>
              </View>

              {/* Target Date Input */}
              <Text style={[styles.sectionLabel, { color: palette.muted }]}>Target Date (YYYY-MM-DD)</Text>
              <View
                style={[
                  styles.inputContainer,
                  {
                    backgroundColor: palette.background,
                    borderColor: validationError ? palette.error : palette.border,
                  },
                ]}
              >
                <Icon color={palette.muted} name="calendar" size={18} style={styles.inputIcon} />
                <TextInput
                  accessibilityLabel="Duplicate target date"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  onChangeText={handleCustomDateChange}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, { color: palette.foreground }]}
                  value={customInput}
                />
              </View>

              {validationError ? (
                <Text style={[styles.errorText, { color: palette.error }]}>{validationError}</Text>
              ) : (
                <Text style={[styles.previewText, { color: palette.muted }]}>
                  Duplicating to: <Text style={[styles.previewHighlight, { color: palette.primary }]}>{formattedPreview}</Text>
                </Text>
              )}
            </View>

            {/* Actions Footer */}
            <View style={[styles.footer, { borderTopColor: palette.border }]}>
              <PressableScale
                accessibilityLabel="Cancel duplicate"
                accessibilityRole="button"
                disabled={isLoading}
                onPress={onCancel}
                style={[styles.cancelBtn, { borderColor: palette.border }]}
              >
                <Text style={[styles.cancelBtnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>

              <PressableScale
                accessibilityLabel="Confirm duplicate"
                accessibilityRole="button"
                disabled={isLoading || Boolean(validationError)}
                onPress={handleConfirm}
                style={[
                  styles.confirmBtn,
                  {
                    backgroundColor: validationError ? palette.muted : palette.primary,
                  },
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.confirmBtnText, { color: colors.onPrimary }]}>Confirm Duplicate</Text>
                )}
              </PressableScale>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  safeContainer: {
    width: '100%',
    maxWidth: 420,
    justifyContent: 'center',
  },
  dialog: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    ...shadows.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitles: {
    flex: 1,
    marginRight: spacing.sm,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: typography.caption,
    marginTop: 2,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  body: {
    padding: spacing.lg,
  },
  sectionLabel: {
    fontSize: typography.eyebrow,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  quickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  quickChip: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickChipText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  inputIcon: {
    marginRight: spacing.xs,
  },
  input: {
    flex: 1,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm : spacing.xs,
    fontSize: typography.body,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  previewText: {
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  previewHighlight: {
    fontWeight: '600',
  },
  errorText: {
    fontSize: typography.caption,
    marginTop: spacing.xs,
    fontWeight: '500',
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1.5,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
