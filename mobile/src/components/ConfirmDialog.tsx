import React from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import { PressableScale } from './PressableScale';
import { WindowsModal } from './WindowsModalHost';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Renders the confirm action in the destructive color. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  palette: Palette;
}

/**
 * Small yes/no modal. Like DateChooserModal it uses RN `Modal`, or the in-app
 * `WindowsModal` overlay on Windows, and stays assertable in
 * react-test-renderer, which `Alert.alert` is not.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
  palette,
}: ConfirmDialogProps) {
  // Windows uses the in-app overlay: RN's Modal opens a separate native window
  // with its own white title bar, which breaks the app's dark chrome. The
  // overlay already fills the app, so no native-window bounds are needed.
  const ModalContainer = Platform.OS === 'windows' ? WindowsModal : Modal;

  return (
    <ModalContainer
      animationType="fade"
      onRequestClose={onCancel}
      transparent={true}
      visible={visible}
    >
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.safeContainer}>
          <View
            accessibilityViewIsModal
            style={[styles.dialog, { backgroundColor: palette.card, borderColor: palette.border }]}
          >
            <Text style={[styles.title, { color: palette.foreground }]}>{title}</Text>
            <Text style={[styles.message, { color: palette.muted }]}>{message}</Text>

            <View style={styles.footer}>
              <PressableScale
                accessibilityLabel={cancelLabel}
                accessibilityRole="button"
                onPress={onCancel}
                style={[styles.cancelBtn, { borderColor: palette.border }]}
              >
                <Text style={[styles.cancelBtnText, { color: palette.foreground }]}>
                  {cancelLabel}
                </Text>
              </PressableScale>

              <PressableScale
                accessibilityLabel={confirmLabel}
                accessibilityRole="button"
                onPress={onConfirm}
                style={[
                  styles.confirmBtn,
                  { backgroundColor: destructive ? palette.error : palette.primary },
                ]}
              >
                <Text style={[styles.confirmBtnText, { color: palette.onPrimary }]}>
                  {confirmLabel}
                </Text>
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
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.md,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: '700',
  },
  message: {
    fontSize: typography.caption,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
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
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontSize: typography.caption,
    fontWeight: '700',
    textAlign: 'center',
  },
});
