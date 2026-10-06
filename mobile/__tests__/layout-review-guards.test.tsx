import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { LayoutCustomizerScreen } from '../src/screens/LayoutCustomizerScreen';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { DEFAULT_MOBILE_LAYOUT, resolveEffectiveLayout } from '../src/navigation/modules';
import type { MobileLayout } from '../src/api/contracts';
import { useSessionActor, useSessionActions, useSessionData, useSessionSync } from '../src/auth/SessionProvider';

jest.mock('../src/auth/SessionProvider', () => ({
  useSessionActor: jest.fn(), useSessionData: jest.fn(), useSessionActions: jest.fn(), useSessionSync: jest.fn(),
}));

const capabilities = {
  canManageWorkspaceCustomization: true, canViewTeam: false, canManageProjects: false,
  canManageActivities: false, canManageUsers: false, canManageSettings: false,
};
const originalLayout = resolveEffectiveLayout(DEFAULT_MOBILE_LAYOUT, DEFAULT_MOBILE_LAYOUT, capabilities);
let renderer: ReactTestRenderer.ReactTestRenderer;
const LayoutContext = React.createContext({ layout: originalLayout, loadLayout: jest.fn() });
let publishLayout: (layout: MobileLayout) => void;
function LayoutData({ children }: { children: React.ReactNode }) {
  const [layout, setLayout] = React.useState(originalLayout);
  publishLayout = setLayout;
  return <LayoutContext.Provider value={{ layout, loadLayout }}>{children}</LayoutContext.Provider>;
}
let actions: {
  updateLayout: jest.Mock; resetLayout: jest.Mock; loadAdminDefaultLayout: jest.Mock;
  updateAdminDefaultLayout: jest.Mock; resetAdminDefaultLayout: jest.Mock;
};
const loadLayout = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  actions = {
    updateLayout: jest.fn(async (layout: MobileLayout) => { publishLayout(layout); }),
    resetLayout: jest.fn(async () => { publishLayout(originalLayout); }),
    loadAdminDefaultLayout: jest.fn().mockResolvedValue(originalLayout),
    updateAdminDefaultLayout: jest.fn(async (layout: MobileLayout) => layout),
    resetAdminDefaultLayout: jest.fn().mockResolvedValue(originalLayout),
  };
  (useSessionActor as jest.Mock).mockReturnValue({ effectiveActor: { capabilities } });
  (useSessionSync as jest.Mock).mockReturnValue({ isOffline: false });
  (useSessionActions as jest.Mock).mockImplementation(() => actions);
  (useSessionData as jest.Mock).mockImplementation(() => React.useContext(LayoutContext));
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => renderer?.unmount());
  ReactTestRenderer.act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function render(onGoBack = jest.fn(), onDirtyChange?: (dirty: boolean) => void) {
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<ScreenTheme><LayoutData>
      <LayoutCustomizerScreen isDarkMode={false} onGoBack={onGoBack} onDirtyChange={onDirtyChange} />
    </LayoutData></ScreenTheme>);
  });
  return onGoBack;
}

async function press(label: string) {
  await ReactTestRenderer.act(async () => {
    await renderer.root.findAllByProps({ accessibilityLabel: label })[0].props.onPress();
  });
}

async function toggle() {
  const control = renderer.root.findByProps({ accessibilityLabel: 'Toggle Mark Leave' });
  await ReactTestRenderer.act(async () => control.props.onValueChange(!control.props.value));
}

async function reset() {
  await press('Reset to Default');
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const buttons = calls[calls.length - 1][2];
  await ReactTestRenderer.act(async () => buttons.find((button: { text: string }) => button.text === 'Reset').onPress());
}

it('seeds both snapshots, preserves workspace edits across scopes and cancels or confirms once', async () => {
  const back = await render();
  await press('Workspace Default Layout');
  await press('Back to more');
  expect(back).toHaveBeenCalledTimes(1); // loading did not mark dirty
  back.mockClear();
  await toggle();
  await press('My Layout Override');
  await press('Back to more');
  expect(back).not.toHaveBeenCalled();
  await press('Cancel');
  await press('Workspace Default Layout');
  expect(renderer.root.findByProps({ accessibilityLabel: 'Toggle Mark Leave' }).props.value).toBe(false);
  await press('Back to more');
  await press('Discard changes');
  expect(back).toHaveBeenCalledTimes(1);
});

it.each(['personal', 'workspace'])('keeps failed %s saves dirty and clears that snapshot on successful save/reset', async scope => {
  const dirty = jest.fn();
  await render(jest.fn(), dirty);
  if (scope === 'workspace') await press('Workspace Default Layout');
  await toggle();
  const save = scope === 'workspace' ? actions.updateAdminDefaultLayout : actions.updateLayout;
  save.mockRejectedValueOnce(new Error('Save failed'));
  await press('Save Layout');
  expect(dirty).toHaveBeenLastCalledWith(true);
  await press('Save Layout');
  expect(dirty).toHaveBeenLastCalledWith(false);
  await toggle();
  expect(dirty).toHaveBeenLastCalledWith(true);
  await reset();
  expect(scope === 'workspace' ? actions.resetAdminDefaultLayout : actions.resetLayout).toHaveBeenCalledTimes(1);
  expect(dirty).toHaveBeenLastCalledWith(false);
});

it('saving or resetting one scope keeps unsaved edits in the other scope dirty', async () => {
  const dirty = jest.fn();
  await render(jest.fn(), dirty);
  await toggle(); // personal dirty
  await press('Workspace Default Layout');
  await toggle();
  await press('Save Layout');
  expect(dirty).toHaveBeenLastCalledWith(true);
  await reset();
  expect(dirty).toHaveBeenLastCalledWith(true);
  await press('My Layout Override');
  await press('Save Layout');
  expect(dirty).toHaveBeenLastCalledWith(false);
  await press('Workspace Default Layout');
  await toggle(); // workspace dirty
  await press('My Layout Override');
  await reset();
  expect(dirty).toHaveBeenLastCalledWith(true);
});

it('delegates dirty header exits to the shell callback without a second dialog', async () => {
  const dirty = jest.fn();
  const back = await render(jest.fn(), dirty);
  await press('Workspace Default Layout');
  await toggle();
  expect(dirty).toHaveBeenLastCalledWith(true);
  await press('Back to more');
  expect(back).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByProps({ accessibilityLabel: 'Discard changes' })).toHaveLength(0);
});
