import React from 'react';
import { ScreenTheme } from '../test-utils/theme-fixture';
import ReactTestRenderer from 'react-test-renderer';
import { UserAdminScreen } from '../src/screens/UserAdminScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('Slice 10: UserAdminScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    ReactTestRenderer.act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  const mockUsers = [
    {
      id: 'u1',
      email: 'alice@vsis.lk',
      name: 'Alice Admin',
      department: 'Operations',
      title: 'Head of Operations',
      role: 'admin',
      permissionRole: 'admin',
      hierarchyRole: 'manager',
      isActive: true,
      managerId: null,
    },
    {
      id: 'u2',
      email: 'bob@vsis.lk',
      name: 'Bob Engineer',
      department: 'Engineering',
      title: 'Senior Software Engineer',
      role: 'user',
      permissionRole: 'user',
      hierarchyRole: 'engineer',
      isActive: true,
      managerId: 'u1',
    },
  ];

  const mockTitles = [
    { id: 't1', name: 'Software Engineer', hierarchyRole: 'engineer' },
    { id: 't2', name: 'Head of Operations', hierarchyRole: 'manager' },
  ];

  it('renders user list, search filtering, user creation and title management flows', async () => {
    const listUsersMock = jest.fn().mockResolvedValue(mockUsers);
    const createUserMock = jest.fn().mockResolvedValue({
      id: 'u3',
      email: 'charlie@vsis.lk',
      name: 'Charlie QA',
      department: 'QA',
      title: 'QA Lead',
      permissionRole: 'user',
      hierarchyRole: 'team_lead',
      isActive: true,
    });
    const listTitlesMock = jest.fn().mockResolvedValue(mockTitles);
    const createTitleMock = jest.fn().mockResolvedValue({
      id: 't3',
      name: 'DevOps Architect',
      hierarchyRole: 'engineer',
    });

    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        refresh: jest.fn().mockResolvedValue({
          accessToken: 'access-123',
          refreshToken: 'refresh-123',
          accessTokenExpiresAt: '',
          sessionId: 's1',
        }),
        getMe: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'alice@vsis.lk',
          role: 'admin',
          permissionRole: 'admin',
          hierarchyRole: 'manager',
          isActive: true,
        }),
        getReference: jest.fn().mockResolvedValue({ projects: [], activityTypes: [] }),
        listAdminUsers: listUsersMock,
        createAdminUser: createUserMock,
        listAdminTitles: listTitlesMock,
        createAdminTitle: createTitleMock,
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    await store.write({ refreshToken: 'initial-refresh', sessionId: 's1' });
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ScreenTheme>
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <UserAdminScreen isDarkMode={false} onBack={onBack} />
        </SessionProvider>
        </ScreenTheme>
      );
    });

    // 1. Verify users rendered
    const aliceNode = renderer!.root.findByProps({ accessibilityLabel: 'User: Alice Admin' });
    const bobNode = renderer!.root.findByProps({ accessibilityLabel: 'User: Bob Engineer' });
    expect(aliceNode).toBeDefined();
    expect(bobNode).toBeDefined();

    // 2. Filter search query
    const searchInput = renderer!.root.findByProps({ accessibilityLabel: 'Search users' });
    await ReactTestRenderer.act(async () => {
      searchInput.props.onChangeText('bob');
    });
    expect(renderer!.root.findByProps({ accessibilityLabel: 'User: Bob Engineer' })).toBeDefined();

    // 3. Open Create User Modal
    const newUserBtn = renderer!.root.findByProps({ accessibilityLabel: 'Add User' });
    await ReactTestRenderer.act(async () => {
      newUserBtn.props.onPress();
    });

    const nameInput = renderer!.root.findByProps({ accessibilityLabel: 'Full Name' });
    const emailInput = renderer!.root.findByProps({ accessibilityLabel: 'Email Address' });
    const pwdInput = renderer!.root.findByProps({ accessibilityLabel: 'Password' });

    await ReactTestRenderer.act(async () => {
      nameInput.props.onChangeText('Charlie QA');
      emailInput.props.onChangeText('charlie@vsis.lk');
      pwdInput.props.onChangeText('SecurePass123!');
    });

    const saveUserBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save User' });
    await ReactTestRenderer.act(async () => {
      saveUserBtn.props.onPress();
    });

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Charlie QA',
        email: 'charlie@vsis.lk',
        password: 'SecurePass123!',
      }),
      expect.any(String)
    );

    // 4. Switch to Titles Tab
    const titlesTab = renderer!.root.findByProps({ accessibilityLabel: 'Titles Tab' });
    await ReactTestRenderer.act(async () => {
      titlesTab.props.onPress();
    });

    const titleItem = renderer!.root.findByProps({ accessibilityLabel: 'Title: Software Engineer' });
    expect(titleItem).toBeDefined();

    // 5. Open Create Title Modal
    const newTitleBtn = renderer!.root.findByProps({ accessibilityLabel: 'Add Title' });
    await ReactTestRenderer.act(async () => {
      newTitleBtn.props.onPress();
    });

    const titleNameInput = renderer!.root.findByProps({ accessibilityLabel: 'New Title Name' });
    await ReactTestRenderer.act(async () => {
      titleNameInput.props.onChangeText('DevOps Architect');
    });

    const saveTitleBtn = renderer!.root.findByProps({ accessibilityLabel: 'Save Title' });
    await ReactTestRenderer.act(async () => {
      saveTitleBtn.props.onPress();
    });

    expect(createTitleMock).toHaveBeenCalledWith(
      { name: 'DevOps Architect', hierarchyRole: 'user' },
      expect.any(String)
    );
  });
});
