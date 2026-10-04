import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import { PressableScale } from './PressableScale';
import { Icon } from './Icon';
import { todayISO, addDaysISO, formatDatePreview, isValidISODate } from '../utils/dates';
import { modalBounds } from '../utils/modal-layout';
import { WindowsModal } from './WindowsModalHost';

export interface DateChooserModalProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  initialDate?: string;
  onConfirm: (targetDate: string) => Promise<void> | void;
  onCancel: () => void;
  isLoading?: boolean;
  palette: Palette;
  /**
   * Call-site copy. The defaults are the duplicate-flow strings this modal was
   * built for, so existing callers keep their behavior unchanged; other flows
   * (e.g. picking the entry date) override them.
   */
  dateInputLabel?: string;
  previewLabel?: string;
  confirmLabel?: string;
  confirmAccessibilityLabel?: string;
  cancelAccessibilityLabel?: string;
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
  dateInputLabel = 'Duplicate target date',
  previewLabel = 'Duplicating to:',
  confirmLabel = 'Confirm Duplicate',
  confirmAccessibilityLabel = 'Confirm duplicate',
  cancelAccessibilityLabel = 'Cancel duplicate',
}: DateChooserModalProps) {
  const isWindows = Platform.OS === 'windows';
  const ModalContainer = isWindows ? WindowsModal : Modal;
  const { width, height } = useWindowDimensions();
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const measureViewport = useCallback(({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    if (layout.width <= 0 || layout.height <= 0) return;
    setViewport((current) => current?.width === layout.width && current.height === layout.height
      ? current
      : { width: layout.width, height: layout.height });
  }, []);
  // RNW window dimensions can lag behind a desktop resize. Measure the
  // full-app backdrop so bounds and compact actions follow the real viewport.
  const bounds = isWindows ? modalBounds(viewport?.width ?? width, viewport?.height ?? height, 420, 480) : {};
  const dialogWidth = typeof bounds.width === 'number' ? bounds.width : width;
  const compact = dialogWidth < 400;
  // The screen retains this modal while closed; refresh shortcuts on reopening.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = useMemo(() => todayISO(), [visible]);
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
    <ModalContainer
      animationType="fade"
      onRequestClose={isLoading ? undefined : onCancel}
      transparent={true}
      visible={visible}
    >
      <View testID="date-chooser-backdrop" onLayout={isWindows ? measureViewport : undefined} style={styles.backdrop}>
        <SafeAreaView style={[styles.safeContainer, isWindows && bounds]}>
          <View
            accessibilityViewIsModal
            style={[
              styles.dialog,
              isWindows && styles.windowsDialog,
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
            <ScrollView
              style={[styles.bodyScroll, isWindows && styles.windowsBodyScroll]}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
            >
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
                      { color: selectedDate === today ? palette.onPrimary : palette.foreground },
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
                      { color: selectedDate === yesterday ? palette.onPrimary : palette.foreground },
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
                  accessibilityLabel={dateInputLabel}
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
                  {previewLabel}{' '}
                  <Text style={[styles.previewHighlight, { color: palette.primary }]}>{formattedPreview}</Text>
                </Text>
              )}
            </ScrollView>

            {/* Actions Footer */}
            <View style={[styles.footer, compact && styles.compactFooter, { borderTopColor: palette.border }]}>
              <PressableScale
                accessibilityLabel={cancelAccessibilityLabel}
                accessibilityRole="button"
                disabled={isLoading}
                onPress={onCancel}
                style={[styles.cancelBtn, compact && styles.compactButton, { borderColor: palette.border }]}
              >
                <Text style={[styles.cancelBtnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>

              <PressableScale
                accessibilityLabel={confirmAccessibilityLabel}
                accessibilityRole="button"
                disabled={isLoading || Boolean(validationError)}
                onPress={handleConfirm}
                style={[
                  styles.confirmBtn,
                  compact && styles.compactButton,
                  {
                    backgroundColor: validationError ? palette.muted : palette.primary,
                  },
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.confirmBtnText, { color: palette.onPrimary }]}>{confirmLabel}</Text>
                )}
              </PressableScale>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </ModalContainer>
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
    maxHeight: '100%',
    justifyContent: 'center',
  },
  dialog: {
    maxHeight: '100%',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    ...shadows.md,
  },
  windowsDialog: {
    width: '100%',
    flex: 1,
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
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xs,
  },
  body: {
    padding: spacing.lg,
  },
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  windowsBodyScroll: {
    flex: 1,
    // Explicit growth wins over flex in Yoga. Override the shared body's
    // flexGrow: 0, otherwise flex: 1 gives this viewport a zero-height basis.
    flexGrow: 1,
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
    minHeight: 44,
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
    minHeight: 44,
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
  compactFooter: {
    flexDirection: 'column',
  },
  compactButton: {
    flex: 0,
    width: '100%',
  },
  cancelBtn: {
    minHeight: 44,
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
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    flex: 1.5,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    textAlign: 'center',
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
