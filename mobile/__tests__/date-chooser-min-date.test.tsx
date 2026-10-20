import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { DateChooserModal } from '../src/components/DateChooserModal';
import { getPalette } from '../src/theme';

async function render(minDate?: string) {
  const onConfirm = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ScreenTheme>
        <DateChooserModal
          confirmLabel="Use"
          initialDate="2026-02-10"
          minDate={minDate}
          onCancel={jest.fn()}
          onConfirm={onConfirm}
          palette={getPalette(false)}
          title="Entry date"
          visible
        />
      </ScreenTheme>
    );
  });
  return { root: renderer.root, onConfirm };
}

const confirm = (root: ReactTestRenderer.ReactTestInstance) =>
  root.findAll(n => n.props.accessibilityLabel === 'Confirm duplicate' && typeof n.props.onPress === 'function')[0];

describe('DateChooserModal minDate', () => {
  it('rejects a typed date before minDate and accepts one inside the window', async () => {
    const { root, onConfirm } = await render('2026-02-05');
    const input = root.findAllByProps({ accessibilityLabel: 'Duplicate target date' })[0];
    await ReactTestRenderer.act(async () => input.props.onChangeText('2026-02-01'));
    await ReactTestRenderer.act(async () => confirm(root).props.onPress());
    expect(onConfirm).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => input.props.onChangeText('2026-02-05'));
    await ReactTestRenderer.act(async () => confirm(root).props.onPress());
    expect(onConfirm).toHaveBeenCalledWith('2026-02-05');
  });

  it('is unrestricted without minDate', async () => {
    const { root, onConfirm } = await render();
    const input = root.findAllByProps({ accessibilityLabel: 'Duplicate target date' })[0];
    await ReactTestRenderer.act(async () => input.props.onChangeText('2020-01-01'));
    await ReactTestRenderer.act(async () => confirm(root).props.onPress());
    expect(onConfirm).toHaveBeenCalledWith('2020-01-01');
  });
});
