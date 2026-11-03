import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { MissingDaysStrip } from '../src/components/MissingDaysStrip';

// 2026-02: Sun 1, Mon 2, Tue 3, Wed 4 (Independence Day, mercantile), Thu 5, Fri 6 = today.
const TODAY = '2026-02-06';

async function render(props: Partial<React.ComponentProps<typeof MissingDaysStrip>>) {
  const onPick = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ScreenTheme>
        <MissingDaysStrip
          listLeaves={jest.fn().mockResolvedValue([])}
          listTimesheets={jest.fn().mockResolvedValue({ rows: [] })}
          onPick={onPick}
          today={TODAY}
          userId="u1"
          {...props}
        />
      </ScreenTheme>
    );
  });
  return { root: renderer!.root, onPick, renderer: renderer! };
}

const label = (root: ReactTestRenderer.ReactTestInstance, prefix: string) =>
  root.findAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(prefix))[0]?.props.accessibilityLabel;

describe('MissingDaysStrip', () => {
  it('marks logged, leave, holiday and missing days, ignoring other users, and picks a missing day', async () => {
    const listTimesheets = jest.fn().mockResolvedValue({
      rows: [
        { id: 't1', user_id: 'u1', log_date: '2026-02-02', hours_worked: 8 },
        { id: 't2', user_id: 'u2', log_date: '2026-02-05', hours_worked: 8 },
      ],
    });
    const listLeaves = jest.fn().mockResolvedValue([
      { id: 'l1', user_id: 'u1', leave_date: '2026-02-03', reason: 'Sick' },
      { id: 'l2', user_id: 'u2', leave_date: '2026-02-06', reason: 'Other' },
    ]);
    const { root, onPick } = await render({ listTimesheets, listLeaves });

    expect(listTimesheets).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', dateFrom: '2026-02-01', dateTo: TODAY }));
    expect(listLeaves).toHaveBeenCalledWith({ from: '2026-02-01', to: TODAY });

    const texts = root.findAllByType(Text).map(t => [t.props.children].flat().join(''));
    expect(texts).toContain('2 working days missing. Tap one to log it.');
    expect(label(root, 'Monday 2 February')).toBe('Monday 2 February: 8h logged');
    expect(label(root, 'Tuesday 3 February')).toBe('Tuesday 3 February: Leave');
    expect(label(root, 'Wednesday 4 February')).toBe('Wednesday 4 February: Independence Day');
    expect(label(root, 'Sunday 1 February')).toBe('Sunday 1 February');
    expect(label(root, 'Monday 9 February')).toBe('Monday 9 February');

    const missingButton = root.findByProps({ accessibilityLabel: 'Thursday 5 February: Missing, log time for this day' });
    await ReactTestRenderer.act(async () => {
      missingButton.props.onPress();
    });
    expect(onPick).toHaveBeenCalledWith('2026-02-05');
    expect(root.findAllByProps({ accessibilityLabel: 'Friday 6 February: Missing, log time for this day' }).length).toBeGreaterThan(0);
  });

  it('gives missing and leave days a non-colour cue: solid 2px ring vs dashed outline', async () => {
    const listLeaves = jest.fn().mockResolvedValue([{ id: 'l1', user_id: 'u1', leave_date: '2026-02-03', reason: 'Sick' }]);
    const listTimesheets = jest.fn().mockResolvedValue({ rows: [{ id: 't1', user_id: 'u1', log_date: '2026-02-02', hours_worked: 8 }] });
    const { root } = await render({ listTimesheets, listLeaves });
    const cell = (prefix: string) => {
      const slot = root.findAll(n => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(prefix))[0];
      const inner = slot.findAll(n => typeof n.type === 'string' && Array.isArray(n.props.style))[0];
      return Object.assign({}, ...[inner.props.style].flat(Infinity).filter(Boolean));
    };
    expect(cell('Thursday 5 February')).toMatchObject({ borderWidth: 2 });
    expect(cell('Thursday 5 February').borderStyle).toBeUndefined();
    expect(cell('Tuesday 3 February')).toMatchObject({ borderStyle: 'dashed', borderWidth: 1 });
    expect(cell('Monday 2 February')).toMatchObject({ borderColor: 'transparent' });
  });

  it('renders nothing when the month cannot be loaded', async () => {
    const { renderer } = await render({ listTimesheets: jest.fn().mockRejectedValue(new Error('offline')) });
    expect(renderer.toJSON()).toBeNull();
  });

  it('renders nothing when the page is full, rather than reporting false gaps', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}`, user_id: 'u1', log_date: '2026-02-02', hours_worked: 0.01 }));
    const { renderer } = await render({ listTimesheets: jest.fn().mockResolvedValue({ rows }) });
    expect(renderer.toJSON()).toBeNull();
  });
});

describe('MissingDaysStrip minLogDate', () => {
  it('keeps missing days before the window red but not tappable', async () => {
    const { root, onPick } = await render({ minLogDate: '2026-02-05' });
    // 02-02 is before the window: still reported missing, but a plain view.
    expect(root.findAllByProps({ accessibilityLabel: 'Monday 2 February: Missing' }).length).toBeGreaterThan(0);
    expect(root.findAllByProps({ accessibilityLabel: 'Monday 2 February: Missing, log time for this day' }).length).toBe(0);
    await ReactTestRenderer.act(async () => {
      root.findAllByProps({ accessibilityLabel: 'Thursday 5 February: Missing, log time for this day' })[0].props.onPress();
    });
    expect(onPick).toHaveBeenCalledWith('2026-02-05');
  });
});
