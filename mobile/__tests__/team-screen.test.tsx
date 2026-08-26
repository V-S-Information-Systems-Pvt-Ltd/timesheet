import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { TeamScreen } from '../src/screens/TeamScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('TeamScreen', () => {
  it('renders team list and handles back navigation', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        listPeople: jest.fn().mockResolvedValue([
          {
            id: 'u1',
            email: 'dev@example.com',
            name: 'Developer One',
            role: 'user',
            permissionRole: 'user',
            hierarchyRole: 'user',
            department: 'Engineering',
            title: 'Frontend Engineer',
            isActive: true,
          },
        ]),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <TeamScreen isDarkMode={false} onBack={onBack} />
        </SessionProvider>
      );
    });

    const backBtn = renderer!.root.findByProps({ accessibilityLabel: 'Back to dashboard' });
    expect(backBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      backBtn.props.onPress();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
