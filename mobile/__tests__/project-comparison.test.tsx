import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { treeText } from '../test-utils/tree-text';
import { ProjectComparison, formatDelta } from '../src/components/ProjectComparison';
import { useTheme } from '../src/theme';

const projects = [{ id: 'p1', name: 'Alpha Core' }];

function Harness({ getReports }: { getReports: jest.Mock }) {
  const palette = useTheme().palette;
  return <ProjectComparison getReports={getReports} palette={palette} projects={projects} />;
}

async function mount(getReports: jest.Mock) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ScreenTheme>
        <Harness getReports={getReports} />
      </ScreenTheme>
    );
  });
  return renderer;
}

async function press(r: ReactTestRenderer.ReactTestRenderer, label: string) {
  await ReactTestRenderer.act(async () => {
    r.root.findAllByProps({ accessibilityLabel: label })[0].props.onPress();
  });
}

const text = treeText;

describe('ProjectComparison', () => {
  it('computes delta hours and percent, guarding a zero baseline', () => {
    expect(formatDelta(40, 50)).toEqual({ hours: '+10.0 hrs', percent: '+25.0%' });
    expect(formatDelta(50, 40)).toEqual({ hours: '-10.0 hrs', percent: '-20.0%' });
    expect(formatDelta(0, 5).percent).toBe('n/a');
    expect(formatDelta(0, 0).percent).toBe('0%');
  });

  it('asks for a project first, then shows both totals and the delta', async () => {
    const getReports = jest.fn()
      .mockResolvedValueOnce({ totalHours: 40, totalEntries: 4, byGroup: [] })
      .mockResolvedValueOnce({ totalHours: 50, totalEntries: 5, byGroup: [] });
    const r = await mount(getReports);
    expect(getReports).not.toHaveBeenCalled();
    expect(text(r)).toContain('Pick a project to compare.');

    await press(r, 'Compare project Alpha Core');
    expect(getReports).toHaveBeenCalledTimes(2);
    expect(getReports.mock.calls[0][0]).toMatchObject({ project: 'p1' });
    expect(text(r)).toContain('A: 40.0 hrs');
    expect(text(r)).toContain('B: 50.0 hrs');
    expect(text(r)).toContain('+10.0 hrs');
    expect(text(r)).toContain('+25.0%');
  });

  it('shows a failing period inline without throwing', async () => {
    const getReports = jest.fn()
      .mockResolvedValueOnce({ totalHours: 40, totalEntries: 4, byGroup: [] })
      .mockRejectedValueOnce(new Error('Period B unavailable'));
    const r = await mount(getReports);
    await press(r, 'Compare project Alpha Core');
    expect(text(r)).toContain('Comparison failed: Period B unavailable');
    expect(text(r)).not.toContain('Change (B vs A)');
  });
});
