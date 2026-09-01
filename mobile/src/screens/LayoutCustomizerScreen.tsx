import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import {
  useSessionActor,
  useSessionData,
  useSessionActions,
  useSessionSync,
} from '../auth/SessionProvider';
import {
  MODULE_REGISTRY,
  ESSENTIAL_MODULE_IDS,
  DEFAULT_MOBILE_LAYOUT,
  resolveEffectiveLayout,
} from '../navigation/modules';
import type { MobileLayout, MobileModuleSetting } from '../api/contracts';

interface LayoutCustomizerScreenProps {
  isDarkMode: boolean;
  onGoBack: () => void;
}

export function LayoutCustomizerScreen({
  isDarkMode,
  onGoBack,
}: LayoutCustomizerScreenProps) {
  const palette = getPalette(isDarkMode);
  const { effectiveActor } = useSessionActor();
  const { layout, loadLayout } = useSessionData();
  const {
    updateLayout,
    resetLayout,
    loadAdminDefaultLayout,
    updateAdminDefaultLayout,
    resetAdminDefaultLayout,
  } = useSessionActions();
  const { isOffline } = useSessionSync();

  const canManageWorkspace = Boolean(effectiveActor?.capabilities?.canManageWorkspaceCustomization);
  const [targetMode, setTargetMode] = useState<'personal' | 'default'>('personal');

  const [personalModules, setPersonalModules] = useState<MobileModuleSetting[]>(() => {
    return resolveEffectiveLayout(layout, DEFAULT_MOBILE_LAYOUT, effectiveActor?.capabilities).modules;
  });
  const [workspaceModules, setWorkspaceModules] = useState<MobileModuleSetting[] | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    if (loadLayout) {
      loadLayout();
    }
  }, [loadLayout]);

  useEffect(() => {
    setPersonalModules(
      resolveEffectiveLayout(layout, DEFAULT_MOBILE_LAYOUT, effectiveActor?.capabilities).modules
    );
  }, [layout, effectiveActor?.capabilities]);

  const handleSwitchToWorkspace = useCallback(async () => {
    if (targetMode === 'default') return;
    if (workspaceModules !== null) {
      setTargetMode('default');
      return;
    }
    if (isOffline) {
      Alert.alert('Offline', 'Cannot load workspace default layout while offline.');
      return;
    }
    setIsLoadingWorkspace(true);
    try {
      const defLayout = await loadAdminDefaultLayout();
      const sanitized = resolveEffectiveLayout(defLayout, DEFAULT_MOBILE_LAYOUT, effectiveActor?.capabilities);
      setWorkspaceModules(sanitized.modules);
      setTargetMode('default');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to load workspace default layout.');
    } finally {
      setIsLoadingWorkspace(false);
    }
  }, [effectiveActor?.capabilities, isOffline, loadAdminDefaultLayout, targetMode, workspaceModules]);

  const handleSwitchToPersonal = useCallback(() => {
    setTargetMode('personal');
  }, []);

  const activeModules = targetMode === 'default' ? (workspaceModules ?? DEFAULT_MOBILE_LAYOUT.modules) : personalModules;

  const handleToggleEnabled = useCallback((id: string, value: boolean) => {
    if (ESSENTIAL_MODULE_IDS.includes(id as any)) return;
    if (targetMode === 'default') {
      setWorkspaceModules((prev) =>
        (prev ?? DEFAULT_MOBILE_LAYOUT.modules).map((m) => (m.id === id ? { ...m, enabled: value } : m))
      );
    } else {
      setPersonalModules((prev) =>
        prev.map((m) => (m.id === id ? { ...m, enabled: value } : m))
      );
    }
  }, [targetMode]);

  const handleTogglePlacement = useCallback((id: string) => {
    if (targetMode === 'default') {
      setWorkspaceModules((prev) =>
        (prev ?? DEFAULT_MOBILE_LAYOUT.modules).map((m) =>
          m.id === id ? { ...m, placement: m.placement === 'home' ? 'more' : 'home' } : m
        )
      );
    } else {
      setPersonalModules((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, placement: m.placement === 'home' ? 'more' : 'home' } : m
        )
      );
    }
  }, [targetMode]);

  const handleMove = useCallback((index: number, direction: 'up' | 'down') => {
    const updater = (prev: MobileModuleSetting[]) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    };
    if (targetMode === 'default') {
      setWorkspaceModules((prev) => updater(prev ?? DEFAULT_MOBILE_LAYOUT.modules));
    } else {
      setPersonalModules((prev) => updater(prev));
    }
  }, [targetMode]);

  const handleSave = useCallback(async () => {
    if (isOffline) {
      Alert.alert('Offline', 'Cannot update layout while offline.');
      return;
    }
    setIsSaving(true);
    try {
      if (targetMode === 'default') {
        const newLayout: MobileLayout = { modules: workspaceModules ?? DEFAULT_MOBILE_LAYOUT.modules };
        const saved = await updateAdminDefaultLayout(newLayout);
        setWorkspaceModules(saved.modules);
        Alert.alert('Success', 'Workspace default mobile layout saved.');
      } else {
        const newLayout: MobileLayout = { modules: personalModules };
        await updateLayout(newLayout);
        Alert.alert('Success', 'Personal mobile layout preferences saved.');
      }
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to save layout.');
    } finally {
      setIsSaving(false);
    }
  }, [isOffline, personalModules, targetMode, updateAdminDefaultLayout, updateLayout, workspaceModules]);

  const handleReset = useCallback(async () => {
    if (isOffline) {
      Alert.alert('Offline', 'Cannot reset layout while offline.');
      return;
    }
    const isDefault = targetMode === 'default';
    Alert.alert(
      isDefault ? 'Reset Workspace Default' : 'Reset Personal Layout',
      isDefault
        ? 'Are you sure you want to restore the factory default layout for all users?'
        : 'Are you sure you want to remove your layout override and inherit the workspace default?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setIsResetting(true);
            try {
              if (isDefault) {
                const restored = await resetAdminDefaultLayout();
                setWorkspaceModules(restored.modules);
                Alert.alert('Success', 'Restored factory default layout.');
              } else {
                await resetLayout();
                Alert.alert('Success', 'Restored workspace default layout.');
              }
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to reset layout.');
            } finally {
              setIsResetting(false);
            }
          },
        },
      ]
    );
  }, [isOffline, resetAdminDefaultLayout, resetLayout, targetMode]);

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        backAccessibilityLabel="Back to more"
        backLabel="‹ More"
        onBack={onGoBack}
        palette={palette}
        subtitle="Customize Home and More screen modules"
        title="Customize Layout"
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {canManageWorkspace && (
          <View style={[styles.modeSelectorContainer, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modeSelectorLabel, { color: palette.foreground }]}>
              Customization Scope
            </Text>
            <View style={styles.modeButtonsRow}>
              <PressableScale
                accessibilityLabel="My Layout Override"
                accessibilityRole="button"
                onPress={handleSwitchToPersonal}
                style={[
                  styles.modeButton,
                  {
                    backgroundColor: targetMode === 'personal' ? colors.primary : palette.badgeBg,
                    borderColor: targetMode === 'personal' ? colors.primary : palette.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    { color: targetMode === 'personal' ? colors.onPrimary : palette.foreground },
                  ]}
                >
                  My Layout
                </Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Workspace Default Layout"
                accessibilityRole="button"
                onPress={handleSwitchToWorkspace}
                style={[
                  styles.modeButton,
                  {
                    backgroundColor: targetMode === 'default' ? colors.primary : palette.badgeBg,
                    borderColor: targetMode === 'default' ? colors.primary : palette.border,
                  },
                ]}
              >
                {isLoadingWorkspace ? (
                  <ActivityIndicator color={targetMode === 'default' ? colors.onPrimary : colors.primary} size="small" />
                ) : (
                  <Text
                    style={[
                      styles.modeButtonText,
                      { color: targetMode === 'default' ? colors.onPrimary : palette.foreground },
                    ]}
                  >
                    Workspace Default
                  </Text>
                )}
              </PressableScale>
            </View>
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: palette.foreground }]}>
          {targetMode === 'default' ? 'Default Workspace Modules' : 'Active Modules'}
        </Text>
        <Text style={[styles.sectionSubtitle, { color: palette.muted }]}>
          {targetMode === 'default'
            ? 'Configure the global default module order and placements for users without custom overrides.'
            : 'Reorder modules or change placement between Home and More tabs. Essential time & profile modules cannot be disabled.'}
        </Text>

        <View style={styles.moduleList}>
          {activeModules.map((m, index) => {
            const meta = MODULE_REGISTRY[m.id];
            if (!meta) return null;
            const isEssential = ESSENTIAL_MODULE_IDS.includes(m.id);

            return (
              <View
                key={m.id}
                style={[
                  styles.card,
                  { backgroundColor: palette.card, borderColor: palette.border },
                ]}
              >
                <View style={[styles.iconWrapper, { backgroundColor: palette.badgeBg }]}>
                  <Icon color={colors.primary} name={meta.icon} size={20} />
                </View>

                <View style={styles.textContainer}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.itemTitle, { color: palette.foreground }]}>
                      {meta.title}
                    </Text>
                    {isEssential && (
                      <View style={[styles.essentialBadge, { backgroundColor: palette.badgeBg }]}>
                        <Text style={[styles.essentialText, { color: colors.primary }]}>
                          Essential
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.itemDescription, { color: palette.muted }]}>
                    {meta.description}
                  </Text>
                  <View style={styles.controlsRow}>
                    <PressableScale
                      accessibilityHint={`Switches placement to ${m.placement === 'home' ? 'More' : 'Home'}`}
                      accessibilityLabel={`Placement: ${m.placement === 'home' ? 'Home Tab' : 'More Tab'}`}
                      accessibilityRole="button"
                      onPress={() => handleTogglePlacement(m.id)}
                      style={[
                        styles.placementButton,
                        { borderColor: palette.border, backgroundColor: palette.badgeBg },
                      ]}
                    >
                      <Text style={[styles.placementText, { color: palette.foreground }]}>
                        Placement: {m.placement === 'home' ? 'Home' : 'More'}
                      </Text>
                    </PressableScale>

                    <View style={styles.orderButtons}>
                      <PressableScale
                        accessibilityLabel={`Move ${meta.title} up`}
                        accessibilityRole="button"
                        disabled={index === 0}
                        onPress={() => handleMove(index, 'up')}
                        style={[styles.arrowButton, index === 0 && styles.disabledOpacity]}
                      >
                        <Icon color={palette.foreground} name="chevron-left" size={16} />
                      </PressableScale>
                      <PressableScale
                        accessibilityLabel={`Move ${meta.title} down`}
                        accessibilityRole="button"
                        disabled={index === activeModules.length - 1}
                        onPress={() => handleMove(index, 'down')}
                        style={[
                          styles.arrowButton,
                          index === activeModules.length - 1 && styles.disabledOpacity,
                        ]}
                      >
                        <Icon color={palette.foreground} name="chevron-right" size={16} />
                      </PressableScale>
                    </View>
                  </View>
                </View>

                <View style={styles.switchContainer}>
                  <Switch
                    accessibilityLabel={`Toggle ${meta.title}`}
                    disabled={isEssential}
                    onValueChange={(val) => handleToggleEnabled(m.id, val)}
                    trackColor={{ false: palette.border, true: colors.primary }}
                    value={m.enabled}
                  />
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.actionButtonsContainer}>
          <PressableScale
            accessibilityHint="Saves customized mobile layout"
            accessibilityLabel="Save Layout"
            accessibilityRole="button"
            disabled={isSaving || isOffline}
            onPress={handleSave}
            style={[
              styles.saveButton,
              { backgroundColor: colors.primary },
              (isSaving || isOffline) && styles.disabledButtonOpacity,
            ]}
          >
            <Text style={styles.saveButtonText}>
              {isSaving ? 'Saving...' : 'Save Layout'}
            </Text>
          </PressableScale>

          <PressableScale
            accessibilityHint="Restores original default mobile layout"
            accessibilityLabel="Reset to Default"
            accessibilityRole="button"
            disabled={isResetting || isOffline}
            onPress={handleReset}
            style={[
              styles.resetButton,
              { borderColor: palette.border, backgroundColor: palette.card },
            ]}
          >
            <Text style={[styles.resetButtonText, { color: palette.foreground }]}>
              {isResetting ? 'Resetting...' : 'Reset to Default'}
            </Text>
          </PressableScale>
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
  sectionTitle: {
    fontSize: typography.heading,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  sectionSubtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  moduleList: {
    gap: spacing.sm,
  },
  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadows.sm,
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  textContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  itemTitle: {
    fontSize: typography.body,
    fontWeight: '700',
  },
  essentialBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  essentialText: {
    fontSize: 10,
    fontWeight: '700',
  },
  itemDescription: {
    fontSize: typography.caption,
    marginTop: 2,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  placementButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
  },
  placementText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  orderButtons: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  arrowButton: {
    padding: 6,
  },
  switchContainer: {
    marginLeft: spacing.xs,
  },
  actionButtonsContainer: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  saveButton: {
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: typography.body,
  },
  resetButton: {
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetButtonText: {
    fontWeight: '600',
    fontSize: typography.body,
  },
  disabledOpacity: {
    opacity: 0.3,
  },
  disabledButtonOpacity: {
    opacity: 0.6,
  },
  modeSelectorContainer: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  modeSelectorLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  modeButtonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeButtonText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
