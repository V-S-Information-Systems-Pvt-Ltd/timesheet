import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { HomeScreen } from '../src/screens/HomeScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('HomeScreen', () => {
  it('renders user details, metric summaries, and action buttons', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        getDashboard: jest.fn().mockResolvedValue({
          actor: {
            id: 'u1',
            email: 'employee@example.com',
            role: 'user',
            permissionRole: 'user',
            hierarchyRole: 'user',
            isActive: true,
          },
          today: { date: '2026-08-26', hours: 7.5 },
          week: { from: '2026-08-20', to: '2026-08-26', hours: 37.5 },
          recentEntries: [
            {
              id: 't1',
              user_id: 'u1',
              project_id: 'p1',
              activity_type_id: 'a1',
              log_date: '2026-08-26',
              hours_worked: 7.5,
              notes: 'Project work',
              status: 'submitted',
            },
          ],
          quickActions: ['create-timesheet'],
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    const onViewTimesheets = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <HomeScreen isDarkMode={false} onViewTimesheets={onViewTimesheets} />
        </SessionProvider>
      );
    });

    const viewAllBtn = renderer!.root.findByProps({ accessibilityLabel: 'View all timesheets' });
    expect(viewAllBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      viewAllBtn.props.onPress();
    });
    expect(onViewTimesheets).toHaveBeenCalledTimes(1);
  });
});
