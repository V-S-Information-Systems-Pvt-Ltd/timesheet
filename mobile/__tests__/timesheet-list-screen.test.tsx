import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { TimesheetListScreen } from '../src/screens/TimesheetListScreen';
import { SessionProvider } from '../src/auth/SessionProvider';
import { MemoryTokenStore } from '../src/platform/secure-storage';
import { ApiClient } from '../src/api/client';

jest.mock('../src/api/client');

describe('TimesheetListScreen', () => {
  it('renders timesheet list with filters and handles back action', async () => {
    (ApiClient as jest.MockedClass<typeof ApiClient>).mockImplementation(() => {
      return {
        getConfig: jest.fn().mockResolvedValue({}),
        listTimesheets: jest.fn().mockResolvedValue({
          rows: [
            {
              id: 't1',
              user_id: 'u1',
              project_id: 'p1',
              activity_type_id: 'a1',
              log_date: '2026-08-26',
              hours_worked: 8,
              notes: 'Daily standup and feature coding',
              status: 'approved',
            },
          ],
        }),
      } as unknown as ApiClient;
    });

    const store = new MemoryTokenStore();
    const onBack = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <SessionProvider initialServerUrl="https://timesheet.example.com" tokenStore={store}>
          <TimesheetListScreen isDarkMode={false} onBack={onBack} />
        </SessionProvider>
      );
    });

    const backBtn = renderer!.root.findByProps({ accessibilityLabel: 'Back to dashboard' });
    expect(backBtn).toBeDefined();

    await ReactTestRenderer.act(async () => {
      backBtn.props.onPress();
    });
    expect(onBack).toHaveBeenCalledTimes(1);

    const filterAll = renderer!.root.findByProps({ accessibilityLabel: 'All' });
    expect(filterAll).toBeDefined();
  });
});
