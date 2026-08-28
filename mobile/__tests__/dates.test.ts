import {
  toISODate,
  todayISO,
  addDaysISO,
  getDatesInRange,
  formatLocalDateTime,
  parseLocalInputToIso,
  formatDatePreview,
} from '../src/utils/dates';

describe('mobile date utilities', () => {
  it('formats dates to ISO date string', () => {
    const d = new Date(2026, 7, 28);
    expect(toISODate(d)).toBe('2026-08-28');
  });

  it('computes today in ISO format', () => {
    const today = todayISO();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('adds and subtracts days to ISO strings safely', () => {
    expect(addDaysISO('2026-08-28', 1)).toBe('2026-08-29');
    expect(addDaysISO('2026-08-28', -1)).toBe('2026-08-27');
    expect(addDaysISO('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysISO('invalid-date', 1)).toBe('invalid-date');
  });

  it('generates date ranges inclusively', () => {
    const range = getDatesInRange('2026-08-28', '2026-08-30');
    expect(range).toEqual(['2026-08-28', '2026-08-29', '2026-08-30']);

    expect(getDatesInRange('2026-08-30', '2026-08-28')).toEqual([]);
    expect(getDatesInRange('invalid', '2026-08-30')).toEqual([]);
  });

  it('formats and parses local datetime strings', () => {
    const d = new Date(2026, 7, 28, 9, 30);
    const local = formatLocalDateTime(d);
    expect(local).toBe('2026-08-28T09:30');

    const parsed = parseLocalInputToIso('2026-08-28T09:30');
    expect(parsed).toBeTruthy();
    expect(parseLocalInputToIso('invalid-datetime')).toBeNull();
    expect(parseLocalInputToIso('2026-13-45T99:99')).toBeNull();
  });

  it('formats preview dates nicely', () => {
    const preview = formatDatePreview('2026-08-28');
    expect(preview).toContain('2026');
    expect(preview).toContain('Aug');
    expect(formatDatePreview('')).toBe('');
  });
});
