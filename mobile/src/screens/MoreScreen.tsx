import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { spacing, typography, borderRadius, useTheme, type ThemePreference } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon, type IconName } from '../components/Icon';
import { useSessionActor, useSessionData } from '../auth/SessionProvider';
import { getVisibleModules } from '../navigation/modules';
import type { AppRoute } from '../navigation/routes';

import appConfig from '../../app.json';

interface MoreScreenProps {
  isDarkMode: boolean;
  onNavigate: (route: AppRoute) => void;
}

export function MoreScreen({ isDarkMode: _isDarkMode, onNavigate }: MoreScreenProps) {
  const palette = useTheme().palette;
  const { effectiveActor } = useSessionActor();
  const { layout } = useSessionData();
  const { preference, setPreference } = useTheme();

  const visibleModules = getVisibleModules(layout, 'more', effectiveActor?.capabilities);
  const versionString = appConfig.version || '0.2.0';

  const themeOptions: ThemePreference[] = ['system', 'light', 'dark'];

  const generalModules = visibleModules.filter((m) => !m.id.startsWith('admin-'));
  const adminModules = visibleModules.filter((m) => m.id.startsWith('admin-'));
  const canManageSettings = Boolean(effectiveActor?.capabilities?.canManageSettings);

  const renderRow = (
    key: string,
    title: string,
    description: string,
    icon: IconName,
    route: AppRoute,
    accessibilityLabel: string = title
  ) => (
    <PressableScale
      key={key}
      accessibilityHint={`Navigates to ${title}`}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={() => onNavigate(route)}
      scaleTo={1}
      style={[styles.row, { borderBottomColor: palette.hairline }]}
    >
      <Icon color={palette.primary} name={icon} size={22} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: palette.foreground }]}>{title}</Text>
        <Text style={[styles.rowSubtitle, { color: palette.muted }]}>{description}</Text>
      </View>
      <Icon color={palette.muted} name="chevron-right" size={18} />
    </PressableScale>
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.paper }]}>
      <ScreenHeader
        palette={palette}
        subtitle="Tools, administration, and account settings"
        title="More"
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        style={[styles.sheet, { backgroundColor: palette.sheet }]}
      >
        {generalModules.map((item) =>
          renderRow(item.id, item.title, item.description, item.icon, item.route)
        )}

        {adminModules.length > 0 || canManageSettings ? (
          <Text style={[styles.sectionHeading, { color: palette.foreground }]}>Administration</Text>
        ) : null}
        {adminModules.map((item) =>
          renderRow(item.id, item.title, item.description, item.icon, item.route)
        )}
        {/* Not a layout module: MobileModuleId is a shared contract, and the server 403 gates the writes. */}
        {canManageSettings
          ? renderRow(
              'departments',
              'Departments',
              'Add, rename, and remove organisation departments',
              'folder',
              'admin-departments'
            )
          : null}

        <Text style={[styles.sectionHeading, { color: palette.foreground }]}>Preferences</Text>
        {renderRow(
          'layout',
          'Customize layout',
          'Reorder modules and choose Home vs More placement',
          'edit',
          'layout-customizer',
          'Customize Layout'
        )}

        <View style={[styles.themeRow, { borderBottomColor: palette.hairline }]}>
          <Text style={[styles.rowSubtitle, { color: palette.muted }]}>Appearance</Text>
          <View style={styles.themeOptionsRow}>
            {themeOptions.map((opt) => (
              <PressableScale
                key={opt}
                accessibilityLabel={`Theme option ${opt}`}
                accessibilityRole="button"
                accessibilityState={{ selected: preference === opt }}
                onPress={() => setPreference(opt)}
                style={[
                  styles.themeOptionBtn,
                  preference === opt
                    ? { backgroundColor: palette.foreground, borderColor: palette.foreground }
                    : { borderColor: palette.controlBorder },
                ]}
              >
                <Text
                  style={[
                    styles.themeOptionText,
                    { color: preference === opt ? palette.paper : palette.muted },
                  ]}
                >
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </Text>
              </PressableScale>
            ))}
          </View>
        </View>

        <View style={styles.appInfoContainer}>
          <Text style={[styles.appVersion, { color: palette.muted }]}>
            VSIS Timesheet v{versionString} (mobile)
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sheet: {
    flex: 1,
    marginTop: spacing.sm,
    borderTopLeftRadius: borderRadius.sheet,
    borderTopRightRadius: borderRadius.sheet,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: typography.body, fontWeight: '600' },
  rowSubtitle: { fontSize: typography.caption, lineHeight: 18 },
  sectionHeading: {
    fontSize: typography.heading,
    fontWeight: '600',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  themeRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  themeOptionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  themeOptionBtn: {
    backgroundColor: 'transparent',
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeOptionText: { fontSize: typography.caption, fontWeight: '600' },
  appInfoContainer: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  appVersion: { fontSize: typography.badge, fontWeight: '500' },
});
