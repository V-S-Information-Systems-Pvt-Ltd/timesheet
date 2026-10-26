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
import { fonts, numeralSizes, spacing, typography, borderRadius, useTheme } from '../theme';
import { PressableScale } from './PressableScale';
import { SearchablePickerModal, type PickerItem } from './SearchablePickerModal';
import { DateChooserModal } from './DateChooserModal';
import { Icon } from './Icon';
import { computeSmartHours, timesheetToLogEntry } from '@vsis/core';
import { recentWorkStore } from '../storage/recent-work-store';
import { todayISO, addDaysISO, formatDatePreview } from '../utils/dates';
import { useBackfillMinDate } from '../utils/use-backfill-min-date';
import { HOURS_STEP, stepHours } from '../utils/hours-stepper';
import {
  ENTRY_TYPES, ENTRY_TYPE_LABELS, ACTIVITIES_BY_TYPE, ACTIVITY_LABELS,
  newEntrySchema, logEntrySchema, normalizeClassification,
  requiresTicketNumber, requiresActivityOther, activityDisplayLabel,
  type EntryType, type ActivityCode, type CreateTimesheetInput,
} from '@vsis/contracts';

export interface TimeEntryFormInitialValues {
  id?: string;
  projectId?: string | null;
  entryType?: EntryType | null;
  activityCode?: ActivityCode | null;
  ticketNumber?: string | null;
  customer?: string | null;
  activityOther?: string | null;
  activityTypeId?: string | null;
  hoursWorked?: number;
  workDone?: string;
  logDate?: string;
}

/** The fields carrying their own validation message, in visual order. */
type FieldKey = 'logDate' | 'entryType' | 'projectId' | 'activityTypeId' | 'activityCode' | 'ticketNumber' | 'customer' | 'activityOther' | 'hoursWorked' | 'workDone';

const FIELD_ORDER: FieldKey[] = ['logDate', 'hoursWorked', 'entryType', 'projectId', 'activityTypeId', 'activityCode', 'customer', 'ticketNumber', 'activityOther', 'workDone'];

const QUICK_PROJECT_COUNT = 4;

interface FormValues {
  logDate: string;
  projectId: string;
  activityTypeId: string;
  entryType: EntryType | '';
  activityCode: ActivityCode | '';
  ticketNumber: string;
  customer: string;
  activityOther: string;
  hoursWorked: string;
  workDone: string;
  /** Earliest writable date; unset until the backfill window loads. */
  minLogDate?: string;
}

function formInput(values: FormValues, legacy: boolean): CreateTimesheetInput {
  const common = { logDate: values.logDate, hoursWorked: Number(values.hoursWorked), workDone: values.workDone.trim() };
  return legacy
    ? { ...common, projectId: values.projectId, activityTypeId: values.activityTypeId }
    : { ...common, projectId: values.projectId || null, entryType: values.entryType || null,
        activityCode: values.activityCode || null, ticketNumber: values.ticketNumber.trim() || null,
        customer: values.customer.trim() || null,
        activityOther: values.activityOther.trim() || null };
}

function validateField(key: FieldKey, values: FormValues, legacy: boolean): string | undefined {
  const result = (legacy ? logEntrySchema : newEntrySchema).safeParse(formInput(values, legacy));
  if (key === 'hoursWorked' && (!Number.isFinite(Number(values.hoursWorked)) || Number(values.hoursWorked) < 0.25 || Number(values.hoursWorked) > 24)) {
    return 'Please enter valid hours between 0.25 and 24.';
  }
  if (key === 'logDate' && values.minLogDate && values.logDate < values.minLogDate) {
    return `Date is before the earliest allowed date (${values.minLogDate}).`;
  }
  if (!legacy && key === 'entryType' && !values.entryType) return 'Please select a type.';
  if (!legacy && key === 'activityCode' && !values.activityCode) return values.entryType ? 'Please select an activity.' : undefined;
  return result.success ? undefined : result.error.issues.find(issue => issue.path[0] === key)?.message;
}

export interface TimeEntryFormProps {
  mode: 'create' | 'edit';
  initialValues?: TimeEntryFormInitialValues;
  isDarkMode: boolean;
  onSubmit: (values: CreateTimesheetInput) => Promise<void>;
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
  const minLogDate = useBackfillMinDate(today);

  const legacy = mode === 'edit' && !initialValues?.entryType;
  const [entryType, setEntryType] = useState<EntryType | ''>(initialValues?.entryType || '');
  const [activityCode, setActivityCode] = useState<ActivityCode | ''>(initialValues?.activityCode || '');
  const [ticketNumber, setTicketNumber] = useState(initialValues?.ticketNumber || '');
  const [customer, setCustomer] = useState(initialValues?.customer || '');
  const [activityOther, setActivityOther] = useState(initialValues?.activityOther || '');
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
   * A submit runs past the form's own lifetime when the user discards the entry
   * while the write is in flight, so the tail of `handleSubmit` checks this
   * before touching the shell or the reducer.
   */
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
    (): FormValues => ({ logDate, projectId, activityTypeId, entryType, activityCode, ticketNumber, customer, activityOther, hoursWorked, workDone, minLogDate }),
    [logDate, projectId, activityTypeId, entryType, activityCode, ticketNumber, customer, activityOther, hoursWorked, workDone, minLogDate]
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
      applyFieldResult(key, validateField(key, values, legacy));
    },
    [applyFieldResult, currentValues, legacy]
  );

  // An initial or drafted date outside the window reports once the window is known.
  useEffect(() => {
    if (minLogDate && logDate < minLogDate) touchedFieldsRef.current.add('logDate');
  }, [minLogDate, logDate]);

  // Once a field has been touched it re-validates as the user edits, so a
  // corrected field stops reporting without waiting for another submit.
  useEffect(() => {
    if (touchedFieldsRef.current.size === 0) return;
    const values = currentValues();
    setFieldErrors((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of FIELD_ORDER) {
        if (!touchedFieldsRef.current.has(key)) continue;
        const message = validateField(key, values, legacy);
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
  }, [currentValues, legacy]);

  const measureField = useCallback(
    (key: FieldKey) => (event: LayoutChangeEvent) => {
      fieldOffsetsRef.current[key] = event.nativeEvent.layout.y;
    },
    []
  );

  const measureForm = useCallback((event: LayoutChangeEvent) => {
    formOffsetRef.current = event.nativeEvent.layout.y;
  }, []);

  const baselineRef = useRef(currentValues());
  const isAtBaseline = useCallback((values: FormValues) =>
    FIELD_ORDER.every(key => values[key] === baselineRef.current[key]), []);

  useEffect(() => {
    loadReference();
    loadDashboard();
  }, [loadReference, loadDashboard]);

  useEffect(() => {
    setRecentSuggestions(recentWorkStore.get(serverUrl, effectiveActor?.id));
  }, [serverUrl, effectiveActor?.id]);

  useEffect(() => {
    onDirtyChange?.(!isAtBaseline(currentValues()));
  }, [currentValues, onDirtyChange, isAtBaseline]);

  const selectedProject = useMemo(
    () => reference?.projects?.find((p) => p.id === projectId),
    [reference?.projects, projectId]
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
      reference?.projects?.filter(p => legacy || p.is_timesheet_project !== false).map((p) => ({
        id: p.id,
        name: p.name,
        subtitle: p.so_number ? `SO: ${p.so_number}` : undefined,
      })) ?? [],
    [reference?.projects, legacy]
  );

  // Project/Internal activities come from the admin-managed catalogue; the
  // built-ins are the fallback until reference data loads.
  const activityOptions = useMemo(() => {
    if (!entryType) return [];
    const fromCatalogue = (reference?.activityTypes ?? [])
      .filter((a) => a.entry_type === entryType && a.code && a.is_active !== false)
      .map((a) => ({ code: a.code as string, label: a.name }));
    const options = fromCatalogue.length ? fromCatalogue : ACTIVITIES_BY_TYPE[entryType].map((code) => ({ code, label: ACTIVITY_LABELS[code] }));
    if (activityCode && !options.some((o) => o.code === activityCode)) options.push({ code: activityCode, label: activityCode });
    return options;
  }, [reference?.activityTypes, entryType, activityCode]);

  const activityPickerItems: PickerItem[] = useMemo(
    () =>
      reference?.activityTypes?.filter((a) => !a.entry_type).map((a) => ({
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
    const values = currentValues();
    const nextErrors: Partial<Record<FieldKey, string>> = {};
    for (const key of FIELD_ORDER) {
      touchedFieldsRef.current.add(key);
      const message = validateField(key, values, legacy);
      if (message) nextErrors[key] = message;
    }
    setFieldErrors(nextErrors);

    const firstInvalid = FIELD_ORDER.find((key) => nextErrors[key]);
    if (firstInvalid) {
      setError(nextErrors[firstInvalid] ?? null);
      scrollToField(firstInvalid);
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const input = formInput(values, legacy);
      await onSubmit(legacy ? logEntrySchema.parse(input) : { ...newEntrySchema.parse(input), ...normalizeClassification(newEntrySchema.parse(input)) });
      // Recorded even when the form unmounted while the write was in flight: the
      // recent-snippets list is shared state, not form state.
      recentWorkStore.add(serverUrl, effectiveActor?.id, workDone.trim());
      // Everything below belongs to this form's own view of the world. A save
      // that outlives its form — the user discarded the entry and started a new
      // draft — must not clear the newer draft's unsaved-changes guard.
      if (!isMountedRef.current) return;
      setRecentSuggestions(recentWorkStore.get(serverUrl, effectiveActor?.id));
      onDirtyChange?.(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save timesheet entry.');
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * The projects this user most likely wants, most recent first, backfilled
   * from the reference order so a first-run user is unaffected. Recency comes
   * from the dashboard's already-loaded recent entries — server-authoritative,
   * and the same source that drives "Copy last entry".
   */
  const quickProjects = useMemo(() => {
    const projects = (reference?.projects ?? []).filter(p => legacy || p.is_timesheet_project !== false);
    const byId = new Map(projects.map((project) => [project.id, project]));
    const ranked: typeof projects = [];
    const seen = new Set<string>();

    for (const entry of dashboard?.recentEntries ?? []) {
      if (ranked.length === QUICK_PROJECT_COUNT) break;
      const project = entry.project_id ? byId.get(entry.project_id) : undefined;
      if (project && !seen.has(project.id)) {
        seen.add(project.id);
        ranked.push(project);
      }
    }
    for (const project of projects) {
      if (ranked.length === QUICK_PROJECT_COUNT) break;
      if (!seen.has(project.id)) {
        seen.add(project.id);
        ranked.push(project);
      }
    }
    return ranked;
  }, [reference?.projects, dashboard?.recentEntries, legacy]);

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

  const chipFill = (active: boolean, errorKey?: FieldKey) => ({
    backgroundColor: active ? palette.foreground : palette.sheet,
    borderColor: active
      ? palette.foreground
      : errorKey && fieldErrors[errorKey]
      ? palette.error
      : palette.controlBorder,
  });
  const chipInk = (active: boolean) => ({ color: active ? palette.paper : palette.foreground });

  /** A label-over-value row: muted label, the value or control, hairline below. */
  function renderRow(key: FieldKey, label: string, body: React.ReactNode, labelRight?: React.ReactNode) {
    return (
      <View
        onLayout={measureField(key)}
        style={[styles.row, { borderBottomColor: fieldErrors[key] ? palette.error : palette.hairline }]}
      >
        <View style={styles.rowLabelLine}>
          <Text style={[styles.rowLabel, { color: palette.muted }]}>{label}</Text>
          {labelRight}
        </View>
        {body}
        {renderFieldError(key)}
      </View>
    );
  }

  const ticketRequired = !legacy && entryType && activityCode ? requiresTicketNumber(entryType, activityCode) : false;
  const otherRequired = !legacy && entryType && activityCode ? requiresActivityOther(entryType, activityCode) : false;
  const detailKey: FieldKey = ticketRequired ? 'ticketNumber' : 'activityOther';

  return (
    <View onLayout={measureForm} style={[styles.formContainer, { backgroundColor: palette.sheet }]}>
      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: palette.error }]}>{error}</Text>
        </View>
      ) : null}

      {/* Copy last entry */}
      {mode === 'create' && lastEntry ? (
        <PressableScale
          accessibilityLabel={`Copy last entry: ${lastEntry.entry_type && lastEntry.activity_code ? activityDisplayLabel(lastEntry.entry_type, lastEntry.activity_code) : 'Legacy — select a type'} ${lastEntry.hours_worked} hours`}
          accessibilityRole="button"
          onPress={() => {
            setEntryType(lastEntry.entry_type || '');
            setActivityCode(lastEntry.activity_code || '');
            setProjectId(lastEntry.entry_type === 'project' ? lastEntry.project_id || '' : '');
            setActivityTypeId('');
            setTicketNumber(lastEntry.ticket_number || '');
            setCustomer(lastEntry.customer || '');
            setActivityOther(lastEntry.activity_other || '');
            setHoursWorked(String(lastEntry.hours_worked));
            setWorkDone(lastEntry.work_done || '');
          }}
          scaleTo={1}
          style={[styles.copyLast, { borderBottomColor: palette.hairline }]}
        >
          <Icon color={palette.primaryText} name="clock" size={16} />
          <Text numberOfLines={1} style={[styles.copyLastText, { color: palette.primaryText }]}>
            Copy last entry: {lastEntry.entry_type && lastEntry.activity_code ? activityDisplayLabel(lastEntry.entry_type, lastEntry.activity_code) : 'Legacy — select a type'}, {lastEntry.hours_worked} h
          </Text>
        </PressableScale>
      ) : null}

      {/* Date: chips for the common days, the field for anything else */}
      {renderRow(
        'logDate',
        'Date',
        <>
          <View style={styles.chipLine}>
            <PressableScale
              accessibilityLabel="Set to today"
              accessibilityRole="button"
              accessibilityState={{ selected: logDate === today }}
              onPress={() => setLogDate(today)}
              style={[styles.chip, chipFill(logDate === today)]}
            >
              <Text style={[styles.chipText, chipInk(logDate === today)]}>Today</Text>
            </PressableScale>
            <PressableScale
              accessibilityLabel="Set to yesterday"
              accessibilityRole="button"
              accessibilityState={{ selected: logDate === yesterday }}
              onPress={() => setLogDate(yesterday)}
              style={[styles.chip, chipFill(logDate === yesterday)]}
            >
              <Text style={[styles.chipText, chipInk(logDate === yesterday)]}>Yesterday</Text>
            </PressableScale>
            <PressableScale
              accessibilityLabel="Open entry date picker"
              accessibilityRole="button"
              accessibilityState={{ selected: logDate !== today && logDate !== yesterday }}
              onPress={() => setIsDatePickerOpen(true)}
              style={[styles.chip, chipFill(logDate !== today && logDate !== yesterday, 'logDate')]}
            >
              <Text style={[styles.chipText, chipInk(logDate !== today && logDate !== yesterday)]}>Pick date</Text>
            </PressableScale>
          </View>
          <View style={styles.dateInputLine}>
            <TextInput
              accessibilityHint={fieldErrors.logDate}
              accessibilityLabel="Log Date"
              autoCapitalize="none"
              autoCorrect={false}
              onBlur={() => touchField('logDate')}
              onChangeText={setLogDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={palette.placeholder}
              style={[styles.input, styles.dateInput, { color: palette.foreground }]}
              value={logDate}
            />
            <PressableScale
              accessibilityLabel="Previous day"
              accessibilityRole="button"
              onPress={() => shiftDate(-1)}
              style={styles.stepIconButton}
            >
              <Icon color={palette.foreground} name="chevron-left" size={18} />
            </PressableScale>
            <PressableScale
              accessibilityLabel="Next day"
              accessibilityRole="button"
              onPress={() => shiftDate(1)}
              style={styles.stepIconButton}
            >
              <Icon color={palette.foreground} name="chevron-right" size={18} />
            </PressableScale>
          </View>
        </>,
        formattedDatePreview ? (
          <Text style={[styles.rowLabelRight, { color: palette.muted }]}>{formattedDatePreview}</Text>
        ) : null
      )}

      {/* Hours: a large numeral with steppers; the field stays editable. */}
      <View
        onLayout={measureField('hoursWorked')}
        style={[styles.hoursBlock, { borderBottomColor: fieldErrors.hoursWorked ? palette.error : palette.hairline }]}
      >
        <View style={styles.hoursStepper}>
          <PressableScale
            accessibilityLabel="Subtract 0.5 hours"
            accessibilityRole="button"
            onPress={() => setHoursWorked(stepHours(hoursWorked, -HOURS_STEP))}
            style={[styles.stepButton, { borderColor: palette.controlBorder }]}
          >
            <Text style={[styles.stepGlyph, { color: palette.foreground }]}>−</Text>
          </PressableScale>
          <TextInput
            accessibilityHint={fieldErrors.hoursWorked}
            accessibilityLabel="Hours Worked"
            keyboardType="decimal-pad"
            onBlur={() => touchField('hoursWorked')}
            onChangeText={setHoursWorked}
            placeholder="0"
            placeholderTextColor={palette.placeholder}
            style={[styles.hoursInput, { color: palette.foreground }]}
            value={hoursWorked}
          />
          <PressableScale
            accessibilityLabel="Add 0.5 hours"
            accessibilityRole="button"
            onPress={() => setHoursWorked(stepHours(hoursWorked, HOURS_STEP))}
            style={[styles.stepButton, { borderColor: palette.controlBorder }]}
          >
            <Text style={[styles.stepGlyph, { color: palette.foreground }]}>+</Text>
          </PressableScale>
        </View>
        <Text style={[styles.hoursCaption, { color: palette.muted }]}>hours worked</Text>
        {renderFieldError('hoursWorked')}
        <View style={[styles.chipLine, styles.chipLineCentered]}>
          {smartHours !== null ? (
            <PressableScale
              accessibilityLabel={`Set smart hours to ${smartHours}`}
              accessibilityRole="button"
              onPress={() => setDirectHours(smartHours)}
              style={[styles.chip, { backgroundColor: palette.sheet, borderColor: palette.controlBorder }]}
            >
              <Text style={[styles.chipText, { color: palette.foreground }]}>{`Suggested ${smartHours} h`}</Text>
            </PressableScale>
          ) : null}
          <PressableScale
            accessibilityLabel="Set to 4.0 hours (half day)"
            accessibilityRole="button"
            onPress={() => setDirectHours(4.0)}
            style={[styles.chip, { backgroundColor: palette.sheet, borderColor: palette.controlBorder }]}
          >
            <Text style={[styles.chipText, { color: palette.foreground }]}>4 h</Text>
          </PressableScale>
          <PressableScale
            accessibilityLabel="Set to 8.0 hours (full day)"
            accessibilityRole="button"
            onPress={() => setDirectHours(8.0)}
            style={[styles.chip, { backgroundColor: palette.sheet, borderColor: palette.controlBorder }]}
          >
            <Text style={[styles.chipText, { color: palette.foreground }]}>8 h</Text>
          </PressableScale>
          {hoursWorked ? (
            <PressableScale
              accessibilityLabel="Clear hours"
              accessibilityRole="button"
              onPress={() => setHoursWorked('')}
              style={[styles.chip, { backgroundColor: palette.sheet, borderColor: palette.controlBorder }]}
            >
              <Text style={[styles.chipText, { color: palette.muted }]}>Clear</Text>
            </PressableScale>
          ) : null}
        </View>
      </View>

      {!legacy
        ? renderRow(
            'entryType',
            'Type',
            <View style={styles.chipLine}>
              {ENTRY_TYPES.map(type => (
                <PressableScale key={type} accessibilityRole="button" accessibilityLabel={ENTRY_TYPE_LABELS[type]}
                  accessibilityState={{ selected: entryType === type }}
                  onPress={() => {
                    setEntryType(type); setProjectId(''); setActivityTypeId(''); setActivityCode('');
                    setTicketNumber(''); setCustomer(''); setActivityOther('');
                    touchField('entryType', { entryType: type });
                  }}
                  style={[styles.chip, chipFill(entryType === type, 'entryType')]}>
                  <Text style={[styles.chipText, chipInk(entryType === type)]}>{ENTRY_TYPE_LABELS[type]}</Text>
                </PressableScale>
              ))}
            </View>
          )
        : null}

      {/* Project: the row opens the searchable picker; recent projects are one tap. */}
      {legacy || entryType === 'project'
        ? renderRow(
            'projectId',
            'Project',
            <>
              <PressableScale
                accessibilityHint={fieldErrors.projectId}
                accessibilityLabel={`Selected project: ${selectedProject?.name || 'None'}. Tap to search or change project`}
                accessibilityRole="button"
                onPress={() => setIsProjectPickerOpen(true)}
                scaleTo={1}
                style={styles.pickerValue}
              >
                <View style={styles.pickerValueText}>
                  <Text
                    numberOfLines={1}
                    style={[styles.pickerName, { color: selectedProject ? palette.foreground : palette.placeholder }]}
                  >
                    {selectedProject?.name || 'Select a project'}
                  </Text>
                  {selectedProject?.so_number ? (
                    <Text style={[styles.pickerSubtitle, { color: palette.muted }]}>
                      SO: {selectedProject.so_number}
                    </Text>
                  ) : null}
                </View>
                <Icon color={palette.muted} name="chevron-right" size={16} />
              </PressableScale>
              {quickProjects.length > 0 ? (
                <ChipRow>
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
                        style={[styles.chip, chipFill(active)]}
                      >
                        <Text numberOfLines={1} style={[styles.chipText, chipInk(active)]}>
                          {proj.name}
                        </Text>
                      </PressableScale>
                    );
                  })}
                  <PressableScale
                    accessibilityLabel="Browse more projects"
                    accessibilityRole="button"
                    onPress={() => setIsProjectPickerOpen(true)}
                    style={[styles.chip, { backgroundColor: palette.sheet, borderColor: palette.controlBorder }]}
                  >
                    <Text style={[styles.chipText, { color: palette.primaryText }]}>
                      {`Browse all (${reference?.projects?.length ?? 0})`}
                    </Text>
                  </PressableScale>
                </ChipRow>
              ) : null}
            </>
          )
        : null}

      {/* Historical activity reference remains editable, never reclassified. */}
      {legacy
        ? renderRow(
            'activityTypeId',
            'Activity type',
            <ChipRow>
              {reference?.activityTypes?.filter((act) => !act.entry_type).map((act) => {
                const active = act.id === activityTypeId;
                return (
                  <PressableScale
                    key={act.id}
                    accessibilityLabel={act.name}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setActivityTypeId(act.id)}
                    style={[styles.chip, chipFill(active)]}
                  >
                    <Text style={[styles.chipText, chipInk(active)]}>{act.name}</Text>
                  </PressableScale>
                );
              })}
            </ChipRow>,
            activityPickerItems.length > 4 ? (
              <Pressable
                accessibilityLabel="Browse all activity types"
                accessibilityRole="button"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => setIsActivityPickerOpen(true)}
              >
                <Text style={[styles.rowLabelRight, { color: palette.primaryText }]}>Browse all</Text>
              </Pressable>
            ) : null
          )
        : entryType
        ? renderRow(
            'activityCode',
            'Activity',
            <View style={styles.chipLine}>
              {activityOptions.map(({ code, label }) => (
                <PressableScale key={code} accessibilityRole="button" accessibilityLabel={label}
                  accessibilityState={{ selected: activityCode === code }}
                  onPress={() => {
                    setActivityCode(code); setTicketNumber(''); setCustomer(''); setActivityOther('');
                    touchField('activityCode', { activityCode: code, ticketNumber: '', customer: '', activityOther: '' });
                  }}
                  style={[styles.chip, chipFill(activityCode === code, 'activityCode')]}>
                  <Text style={[styles.chipText, chipInk(activityCode === code)]}>{label}</Text>
                </PressableScale>
              ))}
            </View>
          )
        : null}

      {ticketRequired
        ? renderRow(
            'customer',
            'Customer',
            <TextInput accessibilityLabel="Customer" accessibilityHint={fieldErrors.customer}
              placeholder="Customer name" placeholderTextColor={palette.placeholder}
              value={customer} onChangeText={setCustomer} onBlur={() => touchField('customer')}
              style={[styles.input, { color: palette.foreground }]} />
          )
        : null}

      {ticketRequired || otherRequired
        ? renderRow(
            detailKey,
            ticketRequired ? 'Ticket number' : 'Other activity',
            <TextInput accessibilityLabel={ticketRequired ? 'Ticket Number' : 'Other Activity'}
              accessibilityHint={fieldErrors.ticketNumber || fieldErrors.activityOther}
              autoCapitalize="none" autoCorrect={false}
              placeholder={ticketRequired ? 'INC 00012345 or SVR 00012345' : 'Describe the activity'}
              placeholderTextColor={palette.placeholder}
              value={ticketRequired ? ticketNumber : activityOther}
              onChangeText={ticketRequired ? setTicketNumber : setActivityOther}
              onBlur={() => touchField(detailKey)}
              style={[styles.input, { color: palette.foreground }]} />
          )
        : null}

      {/* Work done */}
      {renderRow(
        'workDone',
        'Work done',
        <>
          <TextInput
            accessibilityHint={fieldErrors.workDone}
            accessibilityLabel="Work Done"
            autoCapitalize="sentences"
            autoCorrect={true}
            multiline
            numberOfLines={4}
            onBlur={() => touchField('workDone')}
            onChangeText={setWorkDone}
            placeholder="Describe what you worked on"
            placeholderTextColor={palette.placeholder}
            returnKeyType="done"
            style={[styles.input, styles.textArea, { color: palette.foreground }]}
            textAlignVertical="top"
            value={workDone}
          />
          {recentSuggestions.length > 0 ? (
            <View style={styles.recentSuggestionsContainer}>
              <Text style={[styles.quickLabel, { color: palette.muted }]}>Recent work</Text>
              <ChipRow>
                {recentSuggestions.map((text, idx) => (
                  <PressableScale
                    key={idx}
                    accessibilityLabel={`Use recent snippet: ${text}`}
                    accessibilityRole="button"
                    onPress={() => setWorkDone(text)}
                    style={[styles.chip, { backgroundColor: palette.sheet, borderColor: palette.controlBorder }]}
                  >
                    <Text numberOfLines={1} style={[styles.chipText, { color: palette.foreground }]}>
                      {text}
                    </Text>
                  </PressableScale>
                ))}
              </ChipRow>
            </View>
          ) : null}
        </>
      )}

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
            {submitLabel || (mode === 'create' ? 'Save entry' : 'Save changes')}
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
        minDate={minLogDate}
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

/**
 * Mouse users can't swipe a horizontal list, and the wheel scrolls vertically,
 * so on Windows the chips wrap instead of running off the right edge.
 */
function ChipRow({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'windows') return <View style={styles.chipWrap}>{children}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsScroll}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // The sheet: white, rounded at the top, filling the rest of the screen.
  formContainer: {
    width: '100%',
    flexGrow: 1,
    borderTopLeftRadius: borderRadius.sheet,
    borderTopRightRadius: borderRadius.sheet,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  copyLast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  copyLastText: {
    fontSize: typography.caption,
    fontWeight: '600',
    flex: 1,
  },
  errorBox: {
    borderRadius: borderRadius.control,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  fieldErrorText: {
    fontSize: typography.badge,
    fontWeight: '600',
    marginTop: 4,
  },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabelLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  rowLabel: { fontSize: typography.caption, fontWeight: '600' },
  rowLabelRight: { fontSize: typography.caption, fontWeight: '600' },
  pickerValue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    width: '100%',
  },
  pickerValueText: { flex: 1, marginRight: spacing.sm },
  pickerName: { fontSize: typography.body, fontWeight: '600' },
  pickerSubtitle: { fontSize: typography.badge, marginTop: 1 },
  recentSuggestionsContainer: { marginTop: spacing.sm },
  quickLabel: { fontSize: typography.badge, fontWeight: '600', marginBottom: 2 },
  input: {
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: 0,
  },
  dateInputLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dateInput: { flex: 1 },
  stepIconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsScroll: { flexDirection: 'row', marginVertical: spacing.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, marginVertical: spacing.xs },
  chipLine: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipLineCentered: { justifyContent: 'center', marginTop: spacing.md },
  chip: {
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    maxWidth: 260,
  },
  chipText: { fontSize: typography.caption, fontWeight: '600' },
  hoursBlock: {
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hoursStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stepButton: {
    width: 52,
    height: 52,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepGlyph: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.md,
    fontWeight: '600',
  },
  hoursInput: {
    minWidth: 120,
    textAlign: 'center',
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.lg,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    paddingVertical: spacing.xs,
  },
  hoursCaption: { textAlign: 'center', fontSize: typography.caption },
  textArea: { minHeight: 96, textAlignVertical: 'top' },
  button: {
    alignItems: 'center',
    borderRadius: borderRadius.control,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  buttonText: { fontSize: typography.body, fontWeight: '600' },
});
