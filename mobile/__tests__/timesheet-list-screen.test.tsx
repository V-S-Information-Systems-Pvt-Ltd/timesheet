import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { TimesheetListScreen } from '../src/screens/TimesheetListScreen';
import { fakeClient, fakeController, signedInState, withSession } from '../src/test-support';

function entry(id: string) {
  return {
    id,
    user_id: 'u1',
    project_id: 'p1',
    activity_type_id: null,
    log_date: '2026-08-26',
    hours_worked: 4,
    work_done: `Work ${id}`,
    created_at: '2026-08-26T07:00:00Z',
    projects: { name: 'Apollo' },
    profiles: { email: 'user@example.com' },
    activity_types: null,
  };
}

function strings(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAll((node) => typeof node.props.children === 'string')
    .map((node) => node.props.children as string)
    .join('\n');
}

async function renderList(getTimesheets: jest.Mock) {
  const client = fakeClient({ getTimesheets });
  const controller = fakeController(signedInState());
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      withSession(controller, client, <TimesheetListScreen />),
    );
  });
  await ReactTestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(() => resolve(undefined), 0));
  });
  return { renderer, client };
}

describe('TimesheetListScreen', () => {
  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(() => resolve(undefined), 0));
    });
  });

  it('loads the first page with windowed offsets', async () => {
    const getTimesheets = jest.fn().mockResolvedValue({ rows: [entry('t1')], count: 1 });
    const { renderer, client } = await renderList(getTimesheets);

    expect(client.getTimesheets).toHaveBeenCalledWith({
      from: 0,
      to: 19,
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(strings(renderer)).toContain('Apollo');
    // No pagination control when everything fits on one page.
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === 'Load more')).toHaveLength(0);
  });

  it('paginates through the full result set with Load more', async () => {
    const page = (ids: string[], count: number) => ({
      rows: ids.map(entry),
      count,
    });
    const getTimesheets = jest
      .fn()
      .mockResolvedValueOnce(page(['t1', 't2'], 3))
      .mockResolvedValueOnce(page(['t3'], 3));
    const { renderer } = await renderList(getTimesheets);

    const loadMore = renderer.root.find(
      (node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === 'Load more',
    );
    await ReactTestRenderer.act(async () => {
      loadMore.props.onPress();
      await new Promise((resolve) => setTimeout(() => resolve(undefined), 0));
    });

    expect(getTimesheets).toHaveBeenLastCalledWith({
      from: 2,
      to: 21,
      dateFrom: undefined,
      dateTo: undefined,
    });
    expect(strings(renderer)).toContain('Work t3');
  });

  it('rejects malformed date filters without calling the API again', async () => {
    const getTimesheets = jest.fn().mockResolvedValue({ rows: [entry('t1')], count: 1 });
    const { renderer } = await renderList(getTimesheets);

    const fromInput = renderer.root.findByProps({ accessibilityLabel: 'From date' });
    const applyButton = renderer.root.find(
      (node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === 'Apply filter',
    );

    await ReactTestRenderer.act(async () => {
      fromInput.props.onChangeText('26-08-2026');
    });
    await ReactTestRenderer.act(async () => {
      applyButton.props.onPress();
    });

    expect(strings(renderer)).toContain('Use the YYYY-MM-DD date format.');
    expect(getTimesheets).toHaveBeenCalledTimes(1); // initial load only
  });
});
