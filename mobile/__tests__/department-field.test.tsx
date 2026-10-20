import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { DepartmentField } from '../src/components/DepartmentField';
import { getPalette } from '../src/theme';

const lightPalette = getPalette(false);

async function render(props: Partial<React.ComponentProps<typeof DepartmentField>>) {
  const onChange = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ScreenTheme>
        <DepartmentField
          listDepartments={jest.fn().mockResolvedValue([{ name: 'Engineering' }, { name: 'Delivery' }])}
          onChange={onChange}
          palette={lightPalette}
          value=""
          {...props}
        />
      </ScreenTheme>
    );
  });
  return { root: renderer.root, onChange };
}

const pressable = (root: ReactTestRenderer.ReactTestInstance, label: string) =>
  root.findAll(n => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];

describe('DepartmentField', () => {
  it('selects a listed department and maps None to an empty string', async () => {
    const { root, onChange } = await render({ value: 'Engineering' });
    await ReactTestRenderer.act(async () => pressable(root, 'Department: Engineering').props.onPress());
    await ReactTestRenderer.act(async () => pressable(root, 'Delivery').props.onPress());
    expect(onChange).toHaveBeenLastCalledWith('Delivery');
    await ReactTestRenderer.act(async () => pressable(root, 'Department: Engineering').props.onPress());
    await ReactTestRenderer.act(async () => pressable(root, 'None').props.onPress());
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('still offers a current value that is not in the list', async () => {
    const { root } = await render({ value: 'Legacy Dept' });
    await ReactTestRenderer.act(async () => pressable(root, 'Department: Legacy Dept').props.onPress());
    expect(pressable(root, 'Legacy Dept, selected')).toBeDefined();
  });

  it('shows an inline error, keeps the value, and retries on tap when loading fails', async () => {
    const listDepartments = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([{ name: 'Delivery' }]);
    const { root, onChange } = await render({ value: 'Engineering', listDepartments });
    const texts = () => root.findAllByType(Text).map(t => [t.props.children].flat().join(''));
    expect(texts().some(t => t.includes('boom'))).toBe(true);
    expect(texts()).toContain('Engineering');
    await ReactTestRenderer.act(async () => pressable(root, 'Department: Engineering').props.onPress());
    expect(listDepartments).toHaveBeenCalledTimes(2);
    expect(texts().some(t => t.includes('boom'))).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
