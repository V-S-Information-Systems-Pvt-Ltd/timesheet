import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ScreenTheme } from '../test-utils/theme-fixture';
import { treeText } from '../test-utils/tree-text';
import { UserAdminScreen } from '../src/screens/UserAdminScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../test-utils/memory-token-store';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

const person = (id: string, name: string, permissionRole: string, extra: object = {}) => ({
  id,
  email: `${id}@vsis.lk`,
  name,
  role: permissionRole,
  permissionRole,
  hierarchyRole: 'engineer',
  isActive: true,
  ...extra,
});

async function mount(actorRole: string, overrides: Record<string, jest.Mock> = {}, actorExtra: object = {}) {
  const client = {
    getConfig: jest.fn().mockResolvedValue({ apiVersion: 1, capabilities: { mobileApi: true } }),
    refresh: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r', accessTokenExpiresAt: '', sessionId: 's1' }),
    getMe: jest.fn().mockResolvedValue(person('u1', 'Me', actorRole)),
    getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
    listAdminUsers: jest.fn().mockResolvedValue([
      person('u1', 'Me', actorRole, actorExtra),
      person('u2', 'Casey Co', 'co', { scopeDepartments: ['Engineering'] }),
      person('u3', 'Una User', 'user'),
    ]),
    listAdminTitles: jest.fn().mockResolvedValue([]),
    listDepartments: jest.fn().mockResolvedValue([
      { id: 'd1', name: 'Engineering' },
      { id: 'd2', name: 'Finance' },
    ]),
    updateAdminUser: jest.fn().mockResolvedValue({}),
    setUserDepartmentScope: jest.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
  (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => client as unknown as ApiClient);
  const store = new MemoryTokenStore();
  await store.write({ refreshToken: 'initial', sessionId: 's1' });
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <UserAdminScreen isDarkMode={false} onBack={jest.fn()} />
        </SessionProvider>
      </ScreenTheme>
    );
  });
  return { renderer, client };
}

async function press(r: ReactTestRenderer.ReactTestRenderer, label: string) {
  await ReactTestRenderer.act(async () => {
    r.root.findAllByProps({ accessibilityLabel: label })[0].props.onPress();
  });
}

const has = (r: ReactTestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAllByProps({ accessibilityLabel: label }).length > 0;

describe('UserAdminScreen department scope', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('lets an org admin edit scope of an admin/CO user and saves it', async () => {
    const { renderer, client } = await mount('admin');
    await press(renderer, 'Edit Casey Co');
    expect(has(renderer, 'Scope department Finance')).toBe(true);

    await press(renderer, 'Scope department Finance');
    await press(renderer, 'Update User');
    expect(client.setUserDepartmentScope).toHaveBeenCalledWith('u2', ['Engineering', 'Finance'], expect.any(String));
  });

  it('hides scope for plain users and, once the target is switched to user, clears it', async () => {
    const { renderer, client } = await mount('admin');
    await press(renderer, 'Edit Una User');
    expect(has(renderer, 'Scope department Finance')).toBe(false);
    await press(renderer, 'Cancel Edit');

    await press(renderer, 'Edit Casey Co');
    await press(renderer, 'Edit permission role user');
    expect(has(renderer, 'Scope department Finance')).toBe(false);
    await press(renderer, 'Update User');
    expect(client.setUserDepartmentScope).toHaveBeenCalledWith('u2', [], expect.any(String));
  });

  it('hides scope from non-admin actors and from admins who are themselves scoped', async () => {
    const pm = await mount('pm');
    await press(pm.renderer, 'Edit Casey Co');
    expect(has(pm.renderer, 'Scope department Finance')).toBe(false);

    const scoped = await mount('admin', {}, { scopeDepartments: ['Engineering'] });
    await press(scoped.renderer, 'Edit Casey Co');
    expect(has(scoped.renderer, 'Scope department Finance')).toBe(false);
  });

  it('keeps the modal open with a clear message when the scope save is forbidden', async () => {
    const forbidden = Object.assign(new Error('Only admins can set scope'), { status: 403 });
    const { renderer, client } = await mount('admin', { setUserDepartmentScope: jest.fn().mockRejectedValue(forbidden) });
    await press(renderer, 'Edit Casey Co');
    await press(renderer, 'Scope department Finance');
    await press(renderer, 'Update User');
    expect(client.setUserDepartmentScope).toHaveBeenCalled();
    expect(treeText(renderer)).toContain('only organisation admins can change department scope');
  });
});
