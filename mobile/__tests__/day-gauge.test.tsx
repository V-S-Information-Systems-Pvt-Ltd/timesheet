import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { DayGauge } from '../src/components/DayGauge';
import { getPalette } from '../src/theme';

const palette = getPalette(false);

function render(hours: number) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<DayGauge hours={hours} palette={palette} />);
  });
  const root = renderer!.root;
  const widths = root
    .findAllByProps({ testID: 'day-gauge-segment' })
    .filter(n => typeof n.type === 'string')
    .map(seg => {
      const fill = seg.children[0];
      if (typeof fill === 'string' || !fill) return 0;
      const style = ([] as object[]).concat(fill.props.style).reduce((a, b) => ({ ...a, ...b }), {}) as { width: string };
      return parseFloat(style.width);
    });
  const texts = root.findAll(n => (n.type as unknown) === 'Text').map(n => n.children.join(''));
  return {
    widths,
    texts,
    label: root.findByProps({ accessibilityRole: 'progressbar' }).props.accessibilityLabel as string,
    overtimeSegments: root.findAllByProps({ testID: 'day-gauge-overtime' }).filter(n => typeof n.type === 'string').length,
  };
}

describe('DayGauge', () => {
  it('shows eight empty segments at 0 hours', () => {
    const g = render(0);
    expect(g.widths).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(g.label).toBe('0 of 8 hours logged today');
    expect(g.overtimeSegments).toBe(0);
  });

  it('fills a partial segment for fractions', () => {
    const g = render(6.5);
    expect(g.widths).toEqual([100, 100, 100, 100, 100, 100, 50, 0]);
    expect(g.label).toBe('6.5 of 8 hours logged today');
    expect(g.texts.some(t => t.startsWith('+'))).toBe(false);
  });

  it('fills every segment at 8 hours with no overtime', () => {
    const g = render(8);
    expect(g.widths).toEqual([100, 100, 100, 100, 100, 100, 100, 100]);
    expect(g.label).toBe('8 of 8 hours logged today');
    expect(g.overtimeSegments).toBe(0);
  });

  it('adds an outlined overtime segment and +N h beyond 8 hours', () => {
    const g = render(10);
    expect(g.widths).toEqual([100, 100, 100, 100, 100, 100, 100, 100]);
    expect(g.overtimeSegments).toBe(1);
    expect(g.texts).toContain('+2 h');
    expect(g.label).toBe('10 of 8 hours logged today');
  });
});
