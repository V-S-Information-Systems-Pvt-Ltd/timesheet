import { createTimesheetsActions } from '../src/auth/domains/timesheets';
import type { WithAuth } from '../src/auth/domains/types';
import type { ApiClient } from '../src/api/client';
import type { CreateTimesheetInput } from '../src/api/contracts';

const input: CreateTimesheetInput = {
  projectId: 'p1',
  entryType: 'project', activityCode: 'implementation', activityTypeId: null, ticketNumber: null, activityOther: null,
  hoursWorked: 8,
  workDone: 'Reviewed the offline queue',
  logDate: '2026-08-27',
};

/**
 * Mirrors SessionProvider's contract: a request that fails before the server
 * produced a response hands control to `onNetworkFailure` and returns its
 * result, so the caller sees a resolved promise either way.
 */
function makeHarness(options: { failWithNetworkError: boolean }) {
  const sentKeys: string[] = [];
  const client = {
    createTimesheet: jest.fn(
      async (_token: string, _input: unknown, opts: { idempotencyKey: string }) => {
        sentKeys.push(opts.idempotencyKey);
        if (options.failWithNetworkError) {
          throw new TypeError('Network request failed');
        }
        return { success: true };
      }
    ),
  } as unknown as ApiClient;

  const withAuth: WithAuth = async (fn, callOptions) => {
    try {
      return await fn(client, 'access-token');
    } catch (err) {
      if (callOptions?.onNetworkFailure) {
        return callOptions.onNetworkFailure();
      }
      throw err;
    }
  };

  const enqueueCreateTimesheet = jest.fn().mockResolvedValue({ success: true });
  const loadDashboard = jest.fn().mockResolvedValue(null);

  const actions = createTimesheetsActions(withAuth, {
    loadDashboard,
    setDashboard: jest.fn(),
    enqueueCreateTimesheet,
  });

  return { actions, enqueueCreateTimesheet, sentKeys, loadDashboard };
}

describe('createTimesheet outcome', () => {
  it('reports a committed write as not queued', async () => {
    const { actions, enqueueCreateTimesheet, loadDashboard } = makeHarness({
      failWithNetworkError: false,
    });

    await expect(actions.createTimesheet(input)).resolves.toEqual({ queued: false });
    expect(enqueueCreateTimesheet).not.toHaveBeenCalled();
    expect(loadDashboard).toHaveBeenCalled();
  });

  it('reports a network failure as queued and reuses the attempted idempotency key', async () => {
    const { actions, enqueueCreateTimesheet, sentKeys } = makeHarness({
      failWithNetworkError: true,
    });

    await expect(actions.createTimesheet(input)).resolves.toEqual({ queued: true });

    expect(sentKeys).toHaveLength(1);
    expect(enqueueCreateTimesheet).toHaveBeenCalledTimes(1);
    expect(enqueueCreateTimesheet).toHaveBeenCalledWith(input, sentKeys[0]);
  });
});
