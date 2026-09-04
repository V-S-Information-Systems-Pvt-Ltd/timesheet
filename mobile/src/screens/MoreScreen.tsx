import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { spacing, typography, borderRadius, shadows, useTheme, type ThemePreference } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
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

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        palette={palette}
        subtitle="Tools, administration, and account settings"
        title="More"
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.grid}>
          {visibleModules.map((item) => (
            <PressableScale
              key={item.id}
              accessibilityHint={`Navigates to ${item.title}`}
              accessibilityLabel={item.title}
              accessibilityRole="button"
              onPress={() => onNavigate(item.route)}
              style={[
                styles.card,
                { backgroundColor: palette.card, borderColor: palette.border },
              ]}
            >
              <View style={[styles.iconWrapper, { backgroundColor: palette.badgeBg }]}>
                <Icon color={palette.primary} name={item.icon} size={22} />
              </View>
              <View style={styles.cardTextContainer}>
                <Text style={[styles.cardTitle, { color: palette.foreground }]}>
                  {item.title}
                </Text>
                <Text style={[styles.cardSubtitle, { color: palette.muted }]}>
                  {item.description}
                </Text>
              </View>
              <Icon color={palette.muted} name="chevron-right" size={18} />
            </PressableScale>
          ))}

          <PressableScale
            accessibilityHint="Navigates to customize layout"
            accessibilityLabel="Customize Layout"
            accessibilityRole="button"
            onPress={() => onNavigate('layout-customizer')}
            style={[
              styles.card,
              styles.customizerCard,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            <View style={[styles.iconWrapper, { backgroundColor: palette.badgeBg }]}>
              <Icon color={palette.primary} name="edit" size={22} />
            </View>
            <View style={styles.cardTextContainer}>
              <Text style={[styles.cardTitle, { color: palette.foreground }]}>
                Customize Layout
              </Text>
              <Text style={[styles.cardSubtitle, { color: palette.muted }]}>
                Reorder modules and choose Home vs More placement
              </Text>
            </View>
            <Icon color={palette.muted} name="chevron-right" size={18} />
          </PressableScale>

          {/* Theme Preference Card */}
          <View
            style={[
              styles.card,
              styles.themeCard,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            <View style={[styles.iconWrapper, { backgroundColor: palette.badgeBg }]}>
              <Icon color={palette.primary} name="settings" size={22} />
            </View>
            <View style={styles.themeTextContainer}>
              <Text style={[styles.cardTitle, { color: palette.foreground }]}>Appearance</Text>
              <Text style={[styles.cardSubtitle, { color: palette.muted, marginBottom: spacing.sm }]}>
                Choose theme preference
              </Text>
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
                      {
                        backgroundColor: preference === opt ? palette.primary : palette.badgeBg,
                        borderColor: preference === opt ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.themeOptionText,
                        { color: preference === opt ? palette.onPrimary : palette.foreground },
                      ]}
                    >
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.appInfoContainer}>
          <Text style={[styles.appVersion, { color: palette.muted }]}>
            VSIS Timesheet v{versionString} • Mobile Edition
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  grid: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    ...shadows.sm,
  },
  customizerCard: {
    borderStyle: 'dashed',
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  cardTextContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  cardTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  themeCard: {
    alignItems: 'flex-start',
    paddingVertical: spacing.lg,
  },
  themeTextContainer: {
    flex: 1,
  },
  themeOptionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  themeOptionBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeOptionText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  appInfoContainer: {
    marginTop: spacing.xxl,
    alignItems: 'center',
  },
  appVersion: {
    fontSize: typography.badge,
    fontWeight: '500',
  },
});
