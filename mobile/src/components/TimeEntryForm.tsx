import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSessionActor, useSessionDashboard, useSessionReference } from '../auth/SessionProvider';
import { colors, spacing, typography, borderRadius, shadows, useTheme } from '../theme';
import { PressableScale } from './PressableScale';
import { SearchablePickerModal, type PickerItem } from './SearchablePickerModal';
import { DateChooserModal } from './DateChooserModal';
import { Icon } from './Icon';
import { computeSmartHours, timesheetToLogEntry } from '@vsis/core';
import { buildBotCommand } from '../utils/telegram';
import { recentWorkStore } from '../storage/recent-work-store';
import { todayISO, addDaysISO, formatDatePreview } from '../utils/dates';

export interface TimeEntryFormInitialValues {
  id?: string;
  projectId?: string;
  activityTypeId?: string | null;
  hoursWorked?: number;
  workDone?: string;
  logDate?: string;
}

/** The fields carrying their own validation message, in visual order. */
type FieldKey = 'logDate' | 'projectId' | 'activityTypeId' | 'hoursWorked' | 'workDone';

const FIELD_ORDER: FieldKey[] = ['logDate', 'projectId', 'activityTypeId', 'hoursWorked', 'workDone'];

interface FormValues {
  logDate: string;
  projectId: string;
  activityTypeId: string;
  hoursWorked: string;
  workDone: string;
}

/**
 * The single source of truth for what a valid entry looks like. Submit uses it
 * as the authoritative gate; the inline messages read the same rules, so a
 * field never reports something submit would accept (or vice versa).
 */
function validateField(key: FieldKey, values: FormValues): string | undefined {
  switch (key) {
    case 'logDate':
      return values.logDate ? undefined : 'Date is required.';
    case 'projectId':
      return values.projectId ? undefined : 'Please select a project.';
    case 'activityTypeId':
      return values.activityTypeId ? undefined : 'Please select an activity type.';
    case 'hoursWorked': {
      const parsedHours = parseFloat(values.hoursWorked);
      return isNaN(parsedHours) || parsedHours < 0.25 || parsedHours > 24
        ? 'Please enter valid hours between 0.25 and 24.'
        : undefined;
    }
    case 'workDone':
      return values.workDone.trim() ? undefined : 'Work description is required.';
    default:
      return undefined;
  }
}

export interface TimeEntryFormProps {
  mode: 'create' | 'edit';
  initialValues?: TimeEntryFormInitialValues;
  isDarkMode: boolean;
  onSubmit: (values: {
    projectId: string;
    activityTypeId: string;
    hoursWorked: number;
    workDone: string;
    logDate: string;
  }) => Promise<void>;
  onDirtyChange?: (isDirty: boolean) => void;
  submitLabel?: string;
  /**
   * The scroll container that hosts this form. Submit-time failures scroll the
   * first invalid field into view through it; without it the form still
   * reports the error, it just cannot move the viewport.
   */
  scrollViewRef?: React.RefObject<ScrollView | null>;
}

export function TimeEntryForm({
  mode,
  initialValues,
  isDarkMode: _isDarkMode,
  onSubmit,
  onDirtyChange,
  submitLabel,
  scrollViewRef,
}: TimeEntryFormProps) {
  const palette = useTheme().palette;
  const { serverUrl, effectiveActor } = useSessionActor();
  const { reference, loadReference } = useSessionReference();
  const { dashboard, loadDashboard } = useSessionDashboard();

  const today = useMemo(() => todayISO(), []);
  const yesterday = useMemo(() => addDaysISO(today, -1), [today]);

  const [logDate, setLogDate] = useState(initialValues?.logDate || today);
  const [projectId, setProjectId] = useState(initialValues?.projectId || '');
  const [activityTypeId, setActivityTypeId] = useState(initialValues?.activityTypeId || '');
  const [hoursWorked, setHoursWorked] = useState(
    initialValues?.hoursWorked !== undefined ? String(initialValues.hoursWorked) : ''
  );
  const [workDone, setWorkDone] = useState(initialValues?.workDone || '');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const [isActivityPickerOpen, setIsActivityPickerOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const [recentSuggestions, setRecentSuggestions] = useState<string[]>([]);

  /**
   * Per-field messages. A field only gets one once the user has touched it, so
   * a fresh form is not covered in red before anything has been attempted.
   */
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const touchedFieldsRef = useRef<Set<FieldKey>>(new Set());
  // Offsets feed submit-time scroll-to-first-error. Each field measures itself
  // against the form container, and the container against the scroll content.
  const fieldOffsetsRef = useRef<Partial<Record<FieldKey, number>>>({});
  const formOffsetRef = useRef(0);

  const currentValues = useCallback(
    (): FormValues => ({ logDate, projectId, activityTypeId, hoursWorked, workDone }),
    [logDate, projectId, activityTypeId, hoursWorked, workDone]
  );

  const applyFieldResult = useCallback((key: FieldKey, message: string | undefined) => {
    setFieldErrors((prev) => {
      if ((prev[key] ?? undefined) === message) return prev;
      const next = { ...prev };
      if (message) {
        next[key] = message;
      } else {
        delete next[key];
      }
      return next;
    });
  }, []);

  /**
   * Marks a field as user-touched and evaluates it immediately. `override`
   * covers handlers that dispatch a state change in the same tick, so the
   * message reflects what the user just did rather than the previous render.
   */
  const touchField = useCallback(
    (key: FieldKey, override?: Partial<FormValues>) => {
      touchedFieldsRef.current.add(key);
      const values = { ...currentValues(), ...override };
      applyFieldResult(key, validateField(key, values));
    },
    [applyFieldResult, currentValues]
  );

  // Once a field has been touched it re-validates as the user edits, so a
  // corrected field stops reporting without waiting for another submit.
  useEffect(() => {
    if (touchedFieldsRef.current.size === 0) return;
    const values: FormValues = { logDate, projectId, activityTypeId, hoursWorked, workDone };
    setFieldErrors((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of FIELD_ORDER) {
        if (!touchedFieldsRef.current.has(key)) continue;
        const message = validateField(key, values);
        if ((next[key] ?? undefined) !== message) {
          changed = true;
          if (message) {
            next[key] = message;
          } else {
            delete next[key];
          }
        }
      }
      return changed ? next : prev;
    });
  }, [logDate, projectId, activityTypeId, hoursWorked, workDone]);

  const measureField = useCallback(
    (key: FieldKey) => (event: LayoutChangeEvent) => {
      fieldOffsetsRef.current[key] = event.nativeEvent.layout.y;
    },
    []
  );

  const measureForm = useCallback((event: LayoutChangeEvent) => {
    formOffsetRef.current = event.nativeEvent.layout.y;
  }, []);

  /**
   * The settled state an untouched form reports as "clean".
   *
   * Create mode fills its defaults asynchronously: the `internal` project and
   * the first activity type only arrive once `reference` resolves. Comparing
   * against an empty form instead would mark those defaults as user edits and
   * prompt on every exit, so the baseline starts at the form's initial values
   * and then follows the defaults until the user diverges from it.
   */
  const baselineRef = useRef({
    logDate: initialValues?.logDate || today,
    projectId: initialValues?.projectId || '',
    activityTypeId: initialValues?.activityTypeId || '',
    hoursWorked:
      initialValues?.hoursWorked !== undefined ? String(initialValues.hoursWorked) : '',
    workDone: initialValues?.workDone || '',
  });

  const isAtBaseline = useCallback(
    (values: {
      logDate: string;
      projectId: string;
      activityTypeId: string;
      hoursWorked: string;
      workDone: string;
    }) => {
      const baseline = baselineRef.current;
      return (
        values.logDate === baseline.logDate &&
        values.projectId === baseline.projectId &&
        values.activityTypeId === baseline.activityTypeId &&
        values.hoursWorked === baseline.hoursWorked &&
        values.workDone === baseline.workDone
      );
    },
    []
  );

  useEffect(() => {
    loadReference();
    loadDashboard();
  }, [loadReference, loadDashboard]);

  useEffect(() => {
    setRecentSuggestions(recentWorkStore.get(serverUrl, effectiveActor?.id));
  }, [serverUrl, effectiveActor?.id]);

  // Set default project & activity if available in create mode
  useEffect(() => {
    if (mode !== 'create') return;

    const defaultProjectId =
      !projectId && !initialValues?.projectId
        ? reference?.projects?.find((p) => p.name.trim().toLowerCase() === 'internal')?.id
        : undefined;
    const defaultActivityTypeId =
      !activityTypeId && !initialValues?.activityTypeId
        ? reference?.activityTypes?.[0]?.id
        : undefined;

    if (defaultProjectId && defaultProjectId !== projectId) {
      setProjectId(defaultProjectId);
    }
    if (defaultActivityTypeId && defaultActivityTypeId !== activityTypeId) {
      setActivityTypeId(defaultActivityTypeId);
    }

    // Follow the defaults in the baseline while the user has not diverged from
    // it, so a form nobody has touched stays clean.
    if (isAtBaseline({ logDate, projectId, activityTypeId, hoursWorked, workDone })) {
      baselineRef.current = {
        ...baselineRef.current,
        projectId: defaultProjectId ?? baselineRef.current.projectId,
        activityTypeId: defaultActivityTypeId ?? baselineRef.current.activityTypeId,
      };
    }
  }, [
    reference,
    projectId,
    activityTypeId,
    logDate,
    hoursWorked,
    workDone,
    mode,
    initialValues?.projectId,
    initialValues?.activityTypeId,
    isAtBaseline,
  ]);

  // Track dirty state. The first emission on mount is `false`, which also
  // clears any dirty flag a previously mounted form left in the shell.
  useEffect(() => {
    onDirtyChange?.(!isAtBaseline({ logDate, projectId, activityTypeId, hoursWorked, workDone }));
  }, [logDate, projectId, activityTypeId, hoursWorked, workDone, onDirtyChange, isAtBaseline]);

  const selectedProject = useMemo(
    () => reference?.projects?.find((p) => p.id === projectId),
    [reference?.projects, projectId]
  );

  const selectedActivity = useMemo(
    () => reference?.activityTypes?.find((a) => a.id === activityTypeId),
    [reference?.activityTypes, activityTypeId]
  );

  const smartHours = useMemo(() => {
    if (!dashboard?.recentEntries?.length) return null;
    return computeSmartHours(dashboard.recentEntries.map(timesheetToLogEntry));
  }, [dashboard?.recentEntries]);

  const lastEntry = useMemo(() => {
    return dashboard?.recentEntries?.[0] || null;
  }, [dashboard?.recentEntries]);

  const projectPickerItems: PickerItem[] = useMemo(
    () =>
      reference?.projects?.map((p) => ({
        id: p.id,
        name: p.name,
        subtitle: p.so_number ? `SO: ${p.so_number}` : undefined,
      })) ?? [],
    [reference?.projects]
  );

  const activityPickerItems: PickerItem[] = useMemo(
    () =>
      reference?.activityTypes?.map((a) => ({
        id: a.id,
        name: a.name,
      })) ?? [],
    [reference?.activityTypes]
  );

  const handleSelectProject = useCallback(
    (item: PickerItem) => {
      setProjectId(item.id);
      touchField('projectId', { projectId: item.id });
    },
    [touchField]
  );

  const handleSelectActivity = useCallback(
    (item: PickerItem) => {
      setActivityTypeId(item.id);
      touchField('activityTypeId', { activityTypeId: item.id });
    },
    [touchField]
  );

  function addHours(delta: number) {
    const current = parseFloat(hoursWorked) || 0;
    const updated = Math.min(24, Math.max(0, current + delta));
    setHoursWorked(updated > 0 ? String(updated) : '');
  }

  function setDirectHours(hrs: number) {
    setHoursWorked(String(hrs));
  }

  function shiftDate(deltaDays: number) {
    const base = logDate || today;
    setLogDate(addDaysISO(base, deltaDays));
  }

  const formattedDatePreview = useMemo(() => {
    return formatDatePreview(logDate);
  }, [logDate]);

  const telegramCommand = useMemo(() => {
    if (!selectedProject && !selectedActivity) return null;
    const parsedHours = parseFloat(hoursWorked) || 0;
    return buildBotCommand(
      {
        log_date: logDate || today,
        hours_worked: parsedHours,
        work_done: workDone,
      },
      selectedProject,
      selectedActivity,
      today
    );
  }, [selectedProject, selectedActivity, hoursWorked, logDate, today, workDone]);

  /**
   * Brings the first invalid field into view on a failed submit. Platform
   * scroll behavior differs on Windows, and a container that cannot scroll
   * must not turn a validation message into a crash.
   */
  const scrollToField = useCallback(
    (key: FieldKey) => {
      if (Platform.OS === 'windows') return;
      const scroller = scrollViewRef?.current;
      if (!scroller || typeof scroller.scrollTo !== 'function') return;
      const offset = formOffsetRef.current + (fieldOffsetsRef.current[key] ?? 0);
      try {
        scroller.scrollTo({ y: Math.max(0, offset - 8), animated: true });
      } catch {
        // ignore: the message is already visible in the summary box
      }
    },
    [scrollViewRef]
  );

  async function handleSubmit() {
    setError(null);
    const values: FormValues = { logDate, projectId, activityTypeId, hoursWorked, workDone };
    const nextErrors: Partial<Record<FieldKey, string>> = {};
    for (const key of FIELD_ORDER) {
      touchedFieldsRef.current.add(key);
      const message = validateField(key, values);
      if (message) nextErrors[key] = message;
    }
    setFieldErrors(nextErrors);

    const firstInvalid = FIELD_ORDER.find((key) => nextErrors[key]);
    if (firstInvalid) {
      setError(nextErrors[firstInvalid] ?? null);
      scrollToField(firstInvalid);
      return;
    }

    const parsedHours = parseFloat(hoursWorked);
    setIsSubmitting(true);
    try {
      await onSubmit({
        projectId,
        activityTypeId,
        hoursWorked: parsedHours,
        workDone: workDone.trim(),
        logDate,
      });
      recentWorkStore.add(serverUrl, effectiveActor?.id, workDone.trim());
      setRecentSuggestions(recentWorkStore.get(serverUrl, effectiveActor?.id));
      onDirtyChange?.(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save timesheet entry.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const quickProjects = reference?.projects?.slice(0, 4) ?? [];

  /**
   * The per-field message. It is announced politely and mirrored into the
   * owning control's `accessibilityHint`, so a screen reader hears it in the
   * field's context rather than as a detached line.
   */
  function renderFieldError(key: FieldKey) {
    if (!fieldErrors[key]) return null;
    return (
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.fieldErrorText, { color: palette.error }]}
      >
        {fieldErrors[key]}
      </Text>
    );
  }

  const borderFor = (key: FieldKey) => (fieldErrors[key] ? palette.error : palette.border);

  return (
    <View onLayout={measureForm} style={styles.formContainer}>
      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      ) : null}

      {/* Copy Last Entry Banner */}
      {mode === 'create' && lastEntry ? (
        <PressableScale
          accessibilityLabel={`Copy last entry: ${lastEntry.project_name || 'Project'} ${lastEntry.hours_worked} hours`}
          accessibilityRole="button"
          onPress={() => {
            setProjectId(lastEntry.project_id);
            if (lastEntry.activity_type_id) setActivityTypeId(lastEntry.activity_type_id);
            setHoursWorked(String(lastEntry.hours_worked));
            setWorkDone(lastEntry.work_done || '');
          }}
          style={[styles.copyLastCard, { backgroundColor: palette.badgeBg, borderColor: palette.border }]}
        >
          <Icon color={palette.primary} name="clock" size={16} />
          <Text numberOfLines={1} style={[styles.copyLastText, { color: palette.primary }]}>
            Copy last entry: {lastEntry.project_name || 'Project'} • {lastEntry.hours_worked}h
          </Text>
        </PressableScale>
      ) : null}

      {/* Date Selector */}
      <View onLayout={measureField('logDate')} style={styles.fieldGroup}>
        <View style={styles.fieldLabelRow}>
          <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Log Date (YYYY-MM-DD)</Text>
          {formattedDatePreview ? (
            <Text style={[styles.datePreviewText, { color: palette.primary }]}>{formattedDatePreview}</Text>
          ) : null}
        </View>
        <View style={styles.dateRow}>
          <TextInput
            accessibilityHint={fieldErrors.logDate}
            accessibilityLabel="Log Date"
            autoCapitalize="none"
            autoCorrect={false}
            onBlur={() => touchField('logDate')}
            onChangeText={setLogDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={palette.placeholder}
            style={[
              styles.input,
              styles.dateInput,
              {
                backgroundColor: palette.card,
                borderColor: fieldErrors.logDate ? palette.error : palette.border,
                color: palette.foreground,
              },
            ]}
            value={logDate}
          />
          <PressableScale
            accessibilityLabel="Open entry date picker"
            accessibilityRole="button"
            onPress={() => setIsDatePickerOpen(true)}
            style={[
              styles.presetButton,
              styles.stepButton,
              { borderColor: palette.border, backgroundColor: palette.card },
            ]}
          >
            <Icon color={palette.foreground} name="calendar" size={16} />
          </PressableScale>
          <PressableScale
            accessibilityLabel="Previous day"
            accessibilityRole="button"
            onPress={() => shiftDate(-1)}
            style={[
              styles.presetButton,
              styles.stepButton,
              { borderColor: palette.border, backgroundColor: palette.card },
            ]}
          >
            <Text style={[styles.presetText, { color: palette.foreground }]}>-1d</Text>
          </PressableScale>
          <PressableScale
            accessibilityLabel="Next day"
            accessibilityRole="button"
            onPress={() => shiftDate(1)}
            style={[
              styles.presetButton,
              styles.stepButton,
              { borderColor: palette.border, backgroundColor: palette.card },
            ]}
          >
            <Text style={[styles.presetText, { color: palette.foreground }]}>+1d</Text>
          </PressableScale>
          <PressableScale
            accessibilityLabel="Set to today"
            accessibilityRole="button"
            accessibilityState={{ selected: logDate === today }}
            onPress={() => setLogDate(today)}
            style={[
              styles.presetButton,
              logDate === today
                ? [
                    styles.presetButtonActive,
                    { backgroundColor: palette.primary, borderColor: palette.primary },
                  ]
                : { borderColor: palette.border, backgroundColor: palette.card },
            ]}
          >
            <Text
              style={[
                styles.presetText,
                logDate === today
                  ? [styles.presetTextActive, { color: palette.onPrimary }]
                  : { color: palette.foreground },
              ]}
            >
              Today
            </Text>
          </PressableScale>
          <PressableScale
            accessibilityLabel="Set to yesterday"
            accessibilityRole="button"
            accessibilityState={{ selected: logDate === yesterday }}
            onPress={() => setLogDate(yesterday)}
            style={[
              styles.presetButton,
              logDate === yesterday
                ? [
                    styles.presetButtonActive,
                    { backgroundColor: palette.primary, borderColor: palette.primary },
                  ]
                : { borderColor: palette.border, backgroundColor: palette.card },
            ]}
          >
            <Text
              style={[
                styles.presetText,
                logDate === yesterday
                  ? [styles.presetTextActive, { color: palette.onPrimary }]
                  : { color: palette.foreground },
              ]}
            >
              Yesterday
            </Text>
          </PressableScale>
        </View>
        {renderFieldError('logDate')}
      </View>

      {/* Project Selection */}
      <View onLayout={measureField('projectId')} style={styles.fieldGroup}>
        <View style={styles.fieldLabelRow}>
          <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Project</Text>
          <Pressable
            accessibilityLabel="Browse and search all projects"
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setIsProjectPickerOpen(true)}
          >
            <Text style={[styles.browseLink, { color: palette.primary }]}>Search / All →</Text>
          </Pressable>
        </View>

        {/* Main Selected Project Trigger Card */}
        <PressableScale
          accessibilityHint={fieldErrors.projectId}
          accessibilityLabel={`Selected project: ${selectedProject?.name || 'None'}. Tap to search or change project`}
          accessibilityRole="button"
          onPress={() => setIsProjectPickerOpen(true)}
          style={[
            styles.pickerTriggerCard,
            { backgroundColor: palette.card, borderColor: borderFor('projectId') },
          ]}
        >
          <View style={styles.pickerTriggerLeft}>
            <View style={[styles.pickerIconBadge, { backgroundColor: palette.badgeBg }]}>
              <Icon color={palette.primary} name="folder" size={18} />
            </View>
            <View style={styles.pickerTriggerInfo}>
              <Text
                numberOfLines={1}
                style={[
                  styles.pickerTriggerName,
                  { color: selectedProject ? palette.foreground : palette.placeholder },
                ]}
              >
                {selectedProject?.name || 'Select a project...'}
              </Text>
              {selectedProject?.so_number ? (
                <Text style={[styles.pickerTriggerSubtitle, { color: palette.muted }]}>
                  SO: {selectedProject.so_number}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.pickerTriggerRight}>
            <Text style={[styles.pickerActionLabel, { color: palette.primary }]}>Change ▾</Text>
          </View>
        </PressableScale>

        {/* Quick Select Project Chips */}
        {quickProjects.length > 0 ? (
          <View style={styles.quickProjectsContainer}>
            <Text style={[styles.quickLabel, { color: palette.muted }]}>Quick select:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsScroll}>
              {quickProjects.map((proj) => {
                const active = proj.id === projectId;
                return (
                  <PressableScale
                    key={proj.id}
                    accessibilityLabel={`Quick select project ${proj.name}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      setProjectId(proj.id);
                      touchField('projectId', { projectId: proj.id });
                    }}
                    style={[
                      styles.chip,
                      active
                        ? { backgroundColor: palette.primary, borderColor: palette.primary }
                        : { backgroundColor: palette.card, borderColor: palette.border },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.chipText,
                        active ? [styles.chipTextActive, { color: palette.onPrimary }] : { color: palette.foreground },
                      ]}
                    >
                      {proj.name}
                    </Text>
                  </PressableScale>
                );
              })}
              <PressableScale
                accessibilityLabel="Browse more projects"
                accessibilityRole="button"
                onPress={() => setIsProjectPickerOpen(true)}
                style={[
                  styles.chip,
                  styles.moreChip,
                  { backgroundColor: palette.badgeBg, borderColor: palette.border },
                ]}
              >
                <Text style={[styles.chipText, styles.moreChipText, { color: palette.primary }]}>
                  + Browse ({reference?.projects?.length ?? 0})
                </Text>
              </PressableScale>
            </ScrollView>
          </View>
        ) : null}
        {renderFieldError('projectId')}
      </View>

      {/* Activity Type Selection */}
      <View onLayout={measureField('activityTypeId')} style={styles.fieldGroup}>
        <View style={styles.fieldLabelRow}>
          <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Activity Type</Text>
          {activityPickerItems.length > 4 ? (
            <Pressable
              accessibilityLabel="Browse all activity types"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => setIsActivityPickerOpen(true)}
            >
              <Text style={[styles.browseLink, { color: palette.primary }]}>All →</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsScroll}>
          {reference?.activityTypes?.map((act) => {
            const active = act.id === activityTypeId;
            return (
              <PressableScale
                key={act.id}
                accessibilityLabel={act.name}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setActivityTypeId(act.id)}
                style={[
                  styles.chip,
                  active ? { backgroundColor: palette.primary, borderColor: palette.primary } : { backgroundColor: palette.card, borderColor: palette.border },
                ]}
              >
                <Text style={[styles.chipText, active ? [styles.chipTextActive, { color: palette.onPrimary }] : { color: palette.foreground }]}>
                  {act.name}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>
        {renderFieldError('activityTypeId')}
      </View>

      {/* Hours Worked */}
      <View onLayout={measureField('hoursWorked')} style={styles.fieldGroup}>
        <View style={styles.fieldLabelRow}>
          <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Hours Worked</Text>
          {smartHours !== null ? (
            <Text style={[styles.smartHoursBadge, { color: palette.primary }]}>
              Suggested: {smartHours}h
            </Text>
          ) : null}
        </View>
        <TextInput
          accessibilityHint={fieldErrors.hoursWorked}
          accessibilityLabel="Hours Worked"
          keyboardType="decimal-pad"
          onBlur={() => touchField('hoursWorked')}
          onChangeText={setHoursWorked}
          placeholder="e.g. 7.5"
          placeholderTextColor={palette.placeholder}
          style={[
            styles.input,
            {
              backgroundColor: palette.card,
              borderColor: borderFor('hoursWorked'),
              color: palette.foreground,
            },
          ]}
          value={hoursWorked}
        />
        {renderFieldError('hoursWorked')}
        {/* Quick hour step chips */}
        <View style={styles.hourStepRow}>
          {smartHours !== null ? (
            <PressableScale
              accessibilityLabel={`Set smart hours to ${smartHours}`}
              accessibilityRole="button"
              onPress={() => setDirectHours(smartHours)}
              style={[
                styles.hourStepChip,
                styles.smartHourChip,
                { borderColor: palette.primary, backgroundColor: palette.badgeBg },
              ]}
            >
              <Text style={[styles.hourStepText, { color: palette.primary }]}>★ {smartHours}h</Text>
            </PressableScale>
          ) : null}
          <PressableScale
            accessibilityLabel="Add 0.5 hours"
            accessibilityRole="button"
            onPress={() => addHours(0.5)}
            style={[styles.hourStepChip, { borderColor: palette.border, backgroundColor: palette.card }]}
          >
            <Text style={[styles.hourStepText, { color: palette.primary }]}>+0.5h</Text>
          </PressableScale>
          <PressableScale
            accessibilityLabel="Add 1.0 hour"
            accessibilityRole="button"
            onPress={() => addHours(1.0)}
            style={[styles.hourStepChip, { borderColor: palette.border, backgroundColor: palette.card }]}
          >
            <Text style={[styles.hourStepText, { color: palette.primary }]}>+1.0h</Text>
          </PressableScale>
          <PressableScale
            accessibilityLabel="Set to 4.0 hours (half day)"
            accessibilityRole="button"
            onPress={() => setDirectHours(4.0)}
            style={[styles.hourStepChip, { borderColor: palette.border, backgroundColor: palette.card }]}
          >
            <Text style={[styles.hourStepText, { color: palette.primary }]}>4.0h</Text>
          </PressableScale>
          <PressableScale
            accessibilityLabel="Set to 8.0 hours (full day)"
            accessibilityRole="button"
            onPress={() => setDirectHours(8.0)}
            style={[styles.hourStepChip, { borderColor: palette.border, backgroundColor: palette.card }]}
          >
            <Text style={[styles.hourStepText, { color: palette.primary }]}>8.0h</Text>
          </PressableScale>
          {hoursWorked ? (
            <PressableScale
              accessibilityLabel="Clear hours"
              accessibilityRole="button"
              onPress={() => setHoursWorked('')}
              style={[styles.hourStepChip, { borderColor: palette.border, backgroundColor: palette.card }]}
            >
              <Text style={[styles.hourStepText, { color: colors.error }]}>Clear</Text>
            </PressableScale>
          ) : null}
        </View>
      </View>

      {/* Work Description */}
      <View onLayout={measureField('workDone')} style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Work Done / Description</Text>
        <TextInput
          accessibilityHint={fieldErrors.workDone}
          accessibilityLabel="Work Done"
          autoCapitalize="sentences"
          autoCorrect={true}
          multiline
          numberOfLines={4}
          onBlur={() => touchField('workDone')}
          onChangeText={setWorkDone}
          placeholder="Describe what you worked on..."
          placeholderTextColor={palette.placeholder}
          returnKeyType="done"
          style={[
            styles.input,
            styles.textArea,
            {
              backgroundColor: palette.card,
              borderColor: borderFor('workDone'),
              color: palette.foreground,
            },
          ]}
          textAlignVertical="top"
          value={workDone}
        />
        {renderFieldError('workDone')}

        {/* Recent Work Suggestions */}
        {recentSuggestions.length > 0 ? (
          <View style={styles.recentSuggestionsContainer}>
            <Text style={[styles.quickLabel, { color: palette.muted }]}>Recent work snippets:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsScroll}>
              {recentSuggestions.map((text, idx) => (
                <PressableScale
                  key={idx}
                  accessibilityLabel={`Use recent snippet: ${text}`}
                  accessibilityRole="button"
                  onPress={() => setWorkDone(text)}
                  style={[styles.chip, { backgroundColor: palette.card, borderColor: palette.border }]}
                >
                  <Text numberOfLines={1} style={[styles.chipText, { color: palette.foreground }]}>
                    {text}
                  </Text>
                </PressableScale>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>

      {/* Telegram Bot Command Preview */}
      {telegramCommand?.command ? (
        <View style={[styles.telegramCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.telegramHeader}>
            <Icon color={palette.primary} name="tag" size={14} />
            <Text style={[styles.telegramLabel, { color: palette.muted }]}>Telegram Bot Command</Text>
          </View>
          <Text selectable style={[styles.telegramCommand, { color: palette.foreground }]}>
            {telegramCommand.command}
          </Text>
        </View>
      ) : null}

      {/* Submit Button */}
      <PressableScale
        accessibilityLabel={mode === 'create' ? 'Save timesheet entry' : 'Update timesheet entry'}
        accessibilityRole="button"
        accessibilityState={{ busy: isSubmitting }}
        disabled={isSubmitting}
        onPress={handleSubmit}
        style={[styles.button, { backgroundColor: palette.primary }]}
      >
        {isSubmitting ? (
          <ActivityIndicator color={palette.onPrimary} />
        ) : (
          <Text style={[styles.buttonText, { color: palette.onPrimary }]}>
            {submitLabel || (mode === 'create' ? 'Save Timesheet' : 'Update Timesheet')}
          </Text>
        )}
      </PressableScale>

      {/* Project Search Modal */}
      <SearchablePickerModal
        items={projectPickerItems}
        onClose={() => setIsProjectPickerOpen(false)}
        onSelect={handleSelectProject}
        palette={palette}
        searchPlaceholder="Search projects by name or code..."
        selectedId={projectId}
        title="Select Project"
        visible={isProjectPickerOpen}
      />

      {/* Activity Type Search Modal */}
      <SearchablePickerModal
        items={activityPickerItems}
        onClose={() => setIsActivityPickerOpen(false)}
        onSelect={handleSelectActivity}
        palette={palette}
        searchPlaceholder="Search activity types..."
        selectedId={activityTypeId}
        title="Select Activity Type"
        visible={isActivityPickerOpen}
      />

      {/* Entry Date Picker (the inline field stays for manual entry) */}
      <DateChooserModal
        cancelAccessibilityLabel="Cancel date selection"
        confirmAccessibilityLabel="Use entry date"
        confirmLabel="Use This Date"
        dateInputLabel="Entry date"
        initialDate={logDate}
        onCancel={() => setIsDatePickerOpen(false)}
        onConfirm={(date) => {
          setLogDate(date);
          setIsDatePickerOpen(false);
        }}
        palette={palette}
        previewLabel="Logging for:"
        subtitle="Pick the day this work belongs to"
        title="Entry date"
        visible={isDatePickerOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  formContainer: {
    width: '100%',
  },
  copyLastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    gap: spacing.sm,
    minHeight: 44,
    ...shadows.sm,
  },
  copyLastText: {
    fontSize: typography.caption,
    fontWeight: '700',
    flex: 1,
  },
  errorBox: {
    borderRadius: borderRadius.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  fieldErrorText: {
    fontSize: typography.badge,
    fontWeight: '600',
    marginTop: 4,
  },
  fieldGroup: { marginBottom: spacing.md },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700' },
  smartHoursBadge: {
    fontSize: typography.badge,
    fontWeight: '700',
  },
  browseLink: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  pickerTriggerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 52,
    ...shadows.sm,
  },
  pickerTriggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.sm,
  },
  pickerIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  pickerTriggerInfo: {
    flex: 1,
  },
  pickerTriggerName: {
    fontSize: typography.body,
    fontWeight: '700',
  },
  pickerTriggerSubtitle: {
    fontSize: typography.badge,
    marginTop: 1,
  },
  pickerTriggerRight: {
    alignItems: 'flex-end',
  },
  pickerActionLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  quickProjectsContainer: {
    marginTop: spacing.xs,
  },
  recentSuggestionsContainer: {
    marginTop: spacing.xs,
  },
  quickLabel: {
    fontSize: typography.badge,
    fontWeight: '600',
    marginTop: spacing.xs,
    marginBottom: 2,
  },
  input: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  dateInput: { flexGrow: 1, flexShrink: 1, flexBasis: 160 },
  datePreviewText: { fontSize: typography.badge, fontWeight: '700' },
  stepButton: { minWidth: 44, paddingHorizontal: spacing.sm },
  presetButton: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  // The selected colors come from the runtime palette at the call site; this
  // carries the elevation that lifts the active chip off its siblings.
  presetButtonActive: { ...shadows.md },
  presetText: { fontSize: typography.caption, fontWeight: '700' },
  presetTextActive: { fontWeight: '800' },
  optionsScroll: { flexDirection: 'row', marginVertical: spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    maxWidth: 260,
    ...shadows.sm,
  },
  moreChip: {
    borderStyle: 'dashed',
  },
  moreChipText: {
    fontWeight: '700',
  },
  chipText: { fontSize: typography.caption, fontWeight: '600' },
  chipTextActive: { fontWeight: '700' },
  hourStepRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
    flexWrap: 'wrap',
  },
  hourStepChip: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  smartHourChip: {
    borderWidth: 1.5,
  },
  hourStepText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  textArea: { minHeight: 96, paddingTop: spacing.sm, marginTop: spacing.xs },
  telegramCard: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  telegramHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 4,
  },
  telegramLabel: {
    fontSize: typography.badge,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  telegramCommand: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: typography.caption,
    lineHeight: 18,
  },
  button: {
    alignItems: 'center',
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    ...shadows.sm,
  },
  buttonText: { fontSize: typography.body, fontWeight: '700' },
});
