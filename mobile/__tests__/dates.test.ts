import {
  toISODate,
  todayISO,
  addDaysISO,
  getDatesInRange,
  formatLocalDateTime,
  parseLocalInputToIso,
  formatDatePreview,
  formatDateRangeShort,
  formatDateShort,
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

  it('formats a compact readable range without machine-facing ISO dates', () => {
    const range = formatDateRangeShort('2026-08-20', '2026-08-26');
    expect(range).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(range).toContain('20');
    expect(range).toContain('26');
    expect(range).toContain('2026');
  });

  it('echoes malformed range bounds rather than throwing', () => {
    expect(formatDateRangeShort('not-a-date', '2026-08-26')).toBe('not-a-date – 2026-08-26');
    expect(formatDateRangeShort('2026-08-20', '')).toBe('2026-08-20 – ');
  });

  it('formats a single compact date without machine-facing ISO dates', () => {
    const short = formatDateShort('2026-08-26');
    expect(short).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(short).toContain('Aug');
    expect(short).toContain('26');
    expect(short).toContain('2026');
    // Shorter than the full preview so it fits a metric caption.
    expect(short.length).toBeLessThan(formatDatePreview('2026-08-26').length);
  });

  it('echoes a malformed single date rather than throwing', () => {
    expect(formatDateShort('')).toBe('');
    expect(formatDateShort('not-a-date')).toBe('not-a-date');
  });
});
