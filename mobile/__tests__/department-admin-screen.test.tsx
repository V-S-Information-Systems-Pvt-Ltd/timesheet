import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { treeText } from '../test-utils/tree-text';
import { DepartmentAdminScreen } from '../src/screens/DepartmentAdminScreen';
import { useSessionActions, useSessionSync } from '../src/auth/SessionProvider';

jest.mock('../src/auth/SessionProvider');

const forbidden = Object.assign(new Error('Only admins can do that'), { status: 403 });

function setup(overrides: Record<string, jest.Mock> = {}, offline = false) {
  const actions = {
    listDepartments: jest.fn().mockResolvedValue([
      { id: 'd1', name: 'Engineering' },
      { id: 'd2', name: 'Finance' },
    ]),
    createAdminDepartment: jest.fn().mockResolvedValue({ id: 'd3', name: 'Legal' }),
    renameAdminDepartment: jest.fn().mockResolvedValue(undefined),
    deleteAdminDepartment: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  jest.mocked(useSessionActions).mockReturnValue(actions as unknown as ReturnType<typeof useSessionActions>);
  jest.mocked(useSessionSync).mockReturnValue({ isOffline: offline } as ReturnType<typeof useSessionSync>);
  return actions;
}

async function mount() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ScreenTheme>
        <DepartmentAdminScreen isDarkMode={false} onBack={jest.fn()} />
      </ScreenTheme>
    );
  });
  return renderer;
}

async function press(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  await ReactTestRenderer.act(async () => {
    renderer.root.findAllByProps({ accessibilityLabel: label })[0].props.onPress();
  });
}

async function type(renderer: ReactTestRenderer.ReactTestRenderer, label: string, text: string) {
  await ReactTestRenderer.act(async () => {
    renderer.root.findAllByProps({ accessibilityLabel: label })[0].props.onChangeText(text);
  });
}

const text = treeText;

describe('DepartmentAdminScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('lists, searches, creates, renames and deletes departments, refreshing after each write', async () => {
    const actions = setup();
    const r = await mount();
    expect(r.root.findAllByProps({ accessibilityLabel: 'Department: Finance' }).length).toBeGreaterThan(0);

    await type(r, 'Search departments', 'fin');
    expect(r.root.findAllByProps({ accessibilityLabel: 'Department: Engineering' })).toHaveLength(0);
    await type(r, 'Search departments', '');

    await press(r, 'Create Department');
    await type(r, 'Department Name', '  Legal ');
    await press(r, 'Save Department');
    expect(actions.createAdminDepartment).toHaveBeenCalledWith('Legal');
    expect(actions.listDepartments).toHaveBeenCalledTimes(2);

    await press(r, 'Rename Engineering');
    await type(r, 'Department Name', 'Platform');
    await press(r, 'Save Department');
    expect(actions.renameAdminDepartment).toHaveBeenCalledWith('d1', 'Platform');
    expect(actions.listDepartments).toHaveBeenCalledTimes(3);

    await press(r, 'Delete Finance');
    expect(actions.deleteAdminDepartment).not.toHaveBeenCalled();
    await press(r, 'Delete');
    expect(actions.deleteAdminDepartment).toHaveBeenCalledWith('d2');
    expect(actions.listDepartments).toHaveBeenCalledTimes(4);
  });

  it('maps a 403 on create and on delete to the org-admin message', async () => {
    setup({
      createAdminDepartment: jest.fn().mockRejectedValue(forbidden),
      deleteAdminDepartment: jest.fn().mockRejectedValue(forbidden),
    });
    const r = await mount();

    await press(r, 'Create Department');
    await type(r, 'Department Name', 'Legal');
    await press(r, 'Save Department');
    expect(text(r)).toContain('Only organisation admins can manage departments.');

    await press(r, 'Cancel');
    await press(r, 'Delete Finance');
    await press(r, 'Delete');
    expect(text(r)).toContain('Only organisation admins can manage departments.');
  });

  it('blocks writes while offline', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const actions = setup({}, true);
    const r = await mount();

    await press(r, 'Create Department');
    await press(r, 'Delete Finance');
    expect(alert).toHaveBeenCalledWith('Offline', 'Cannot change departments while offline.');
    expect(alert).toHaveBeenCalledWith('Offline', 'Cannot delete departments while offline.');
    expect(actions.createAdminDepartment).not.toHaveBeenCalled();
    expect(actions.deleteAdminDepartment).not.toHaveBeenCalled();
  });
});
