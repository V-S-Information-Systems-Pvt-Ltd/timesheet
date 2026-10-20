import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ReportsScreen } from '../src/screens/ReportsScreen';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { useSessionActions, useSessionStatus } from '../src/auth/SessionProvider';

jest.mock('../src/auth/SessionProvider', () => ({
  useSessionActions: jest.fn(), useSessionStatus: jest.fn(),
}));

const report = { totalHours: 20, totalEntries: 3, byGroup: [{ label: 'Alpha', hours: 20, entries: 3 }] };
const rows = [
  { id: 'a', log_date: '2026-02-03', hours_worked: 10 },
  { id: 'b', log_date: '2026-02-05', hours_worked: 8 },
  { id: 'c', log_date: '2026-02-05', hours_worked: 0 },
];

async function render(actions: Record<string, jest.Mock>) {
  (useSessionStatus as jest.Mock).mockReturnValue({ actor: { id: 'u1', role: 'user' }, effectiveActor: null });
  (useSessionActions as jest.Mock).mockReturnValue({ getReports: jest.fn().mockResolvedValue(report), ...actions });
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ScreenTheme><ReportsScreen isDarkMode={false} onBack={jest.fn()} /></ScreenTheme>
    );
  });
  return renderer;
}

const cards = (r: ReactTestRenderer.ReactTestRenderer) =>
  Object.fromEntries(r.root.findAll((n) => typeof n.props.label === 'string' && 'palette' in n.props && 'value' in n.props).map((c) => [c.props.label, c.props.value]));
const has = (r: ReactTestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAllByProps({ accessibilityLabel: label }).length > 0;

describe('ReportsScreen insights', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Feb 2026 contains the mercantile holiday 2026-02-04 (Wed).
    jest.setSystemTime(new Date(2026, 1, 20, 12));
  });
  afterEach(() => jest.useRealTimers());

  it('shows expected, after-office and leave hours for the month', async () => {
    const listLeaves = jest.fn().mockResolvedValue([
      { id: 'l1', user_id: 'u1', leave_date: '2026-02-09', reason: '' },
      { id: 'l2', user_id: 'u1', leave_date: '2026-02-10', reason: '' },
    ]);
    const listTimesheets = jest.fn().mockResolvedValue({ rows });
    const r = await render({ listLeaves, listTimesheets });
    expect(listLeaves).toHaveBeenCalledWith({ from: '2026-02-01', to: '2026-02-20' });
    expect(listTimesheets).toHaveBeenCalledWith({ userId: 'u1', dateFrom: '2026-02-01', dateTo: '2026-02-20', from: 0, to: 999 });
    // 15 weekdays minus the Feb 4 holiday = 14 days x 8h.
    expect(cards(r)['Expected hours']).toBe('112.0');
    expect(cards(r)['After-office hours']).toBe('2.0');
    expect(cards(r)['Leave hours']).toBe('16.0');
    await ReactTestRenderer.act(async () => { r.unmount(); });
  });

  it('hides only the leave card when leaves fail to load', async () => {
    const r = await render({
      listLeaves: jest.fn().mockRejectedValue(new Error('boom')),
      listTimesheets: jest.fn().mockResolvedValue({ rows }),
    });
    expect(cards(r)['Expected hours']).toBe('112.0');
    expect(cards(r)['After-office hours']).toBe('2.0');
    expect(cards(r)).not.toHaveProperty('Leave hours');
    expect(r.root.findAllByProps({ children: 'Total Logged' }).length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { r.unmount(); });
  });

  it('hides after-office and bars when the 1000-row page may be truncated', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, log_date: '2026-02-03', hours_worked: 1 }));
    const r = await render({
      listLeaves: jest.fn().mockResolvedValue([]),
      listTimesheets: jest.fn().mockResolvedValue({ rows: full }),
    });
    expect(cards(r)).not.toHaveProperty('After-office hours');
    expect(r.root.findAllByProps({ testID: 'daily-hours-bars' }).length).toBe(0);
    expect(cards(r)['Leave hours']).toBe('0.0');
    await ReactTestRenderer.act(async () => { r.unmount(); });
  });

  it('draws one labelled bar per day of the range', async () => {
    const r = await render({
      listLeaves: jest.fn().mockResolvedValue([]),
      listTimesheets: jest.fn().mockResolvedValue({ rows }),
    });
    expect(has(r, '2026-02-03: 10 hours')).toBe(true);
    expect(has(r, '2026-02-05: 8 hours')).toBe(true);
    expect(has(r, '2026-02-04: 0 hours')).toBe(true);
    expect(has(r, '2026-02-01: 0 hours')).toBe(true);
    await ReactTestRenderer.act(async () => { r.unmount(); });
  });

  it('caps the bars at the last 31 days of a long range', async () => {
    const { DailyHoursBars } = jest.requireActual('../src/components/DailyHoursBars');
    const { getPalette } = jest.requireActual('../src/theme');
    let r!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      r = ReactTestRenderer.create(<DailyHoursBars from="2026-01-01" palette={getPalette(false)} rows={[]} to="2026-03-31" />);
    });
    const bars = r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && /hours$/.test(n.props.accessibilityLabel) && typeof n.type === 'string');
    expect(bars).toHaveLength(31);
    expect(has(r, '2026-03-31: 0 hours')).toBe(true);
    expect(has(r, '2026-02-28: 0 hours')).toBe(false);
  });
});
