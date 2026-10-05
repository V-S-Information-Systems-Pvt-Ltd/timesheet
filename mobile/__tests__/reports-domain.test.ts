import type { ApiClient } from '../src/api/client';
import { SessionController } from '../src/auth/session-controller';
import { createReportsActions } from '../src/auth/domains/reports';
import { reportFileExporter, type ReportExportOutcome } from '../src/services/reportFileExport';
import { MemoryTokenStore } from '../test-utils/memory-token-store';

const actor = { id: 'a', email: 'a@example.com', role: 'user', permissionRole: 'user', hierarchyRole: 'user', isActive: true };
const unauthorized: ReportExportOutcome = { kind: 'failed', retryable: true, reason: 'unauthorized' };

function setup() {
  const api = {
    login: jest.fn().mockResolvedValue({ accessToken: 'access-a', refreshToken: 'refresh-a', sessionId: 'a', actor }),
    refresh: jest.fn().mockResolvedValue({ accessToken: 'access-new', refreshToken: 'refresh-new', sessionId: 'a' }),
    getMe: jest.fn().mockResolvedValue(actor),
    logout: jest.fn().mockResolvedValue(undefined), logoutAll: jest.fn().mockResolvedValue(undefined),
  };
  const store = new MemoryTokenStore();
  const controller = new SessionController(api, store);
  const setAccessToken = jest.fn();
  const getValidToken = jest.fn().mockResolvedValue('access-a');
  const actions = createReportsActions(jest.fn(), {
    client: { baseUrl: 'https://workspace.example' } as ApiClient,
    controller, getValidToken, setAccessToken, setActor: jest.fn(),
  });
  return { api, store, controller, actions, setAccessToken, getValidToken };
}

describe('report export session ownership', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not refresh, retry, or publish a token for an obsolete export after account replacement', async () => {
    const { api, store, controller, actions, setAccessToken } = setup();
    await controller.signIn({ email: actor.email, password: 'secret' });
    let complete!: (result: ReportExportOutcome) => void;
    const exporter = jest.spyOn(reportFileExporter, 'export').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const read = jest.spyOn(store, 'read');
    const pending = actions.exportReportsFile();
    for (let attempt = 0; attempt < 20 && !exporter.mock.calls.length; attempt++) await Promise.resolve();
    expect(exporter).toHaveBeenCalledTimes(1);
    api.login.mockResolvedValue({ accessToken: 'access-b', refreshToken: 'refresh-b', sessionId: 'b', actor: { ...actor, id: 'b' } });
    await controller.signIn({ email: 'b@example.com', password: 'secret' });
    complete(unauthorized);
    expect(await pending).toEqual(unauthorized);
    expect(read).not.toHaveBeenCalled();
    expect(api.refresh).not.toHaveBeenCalled();
    expect(setAccessToken).not.toHaveBeenCalled();
    expect(exporter).toHaveBeenCalledTimes(1);
    expect(await store.read()).toEqual({ refreshToken: 'refresh-b', sessionId: 'b' });
  });

  it('refreshes and retries an export belonging to the active session', async () => {
    const { api, controller, actions, setAccessToken } = setup();
    await controller.signIn({ email: actor.email, password: 'secret' });
    const exporter = jest.spyOn(reportFileExporter, 'export').mockResolvedValueOnce(unauthorized).mockResolvedValueOnce({ kind: 'saved' });
    expect(await actions.exportReportsFile()).toEqual({ kind: 'saved' });
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(setAccessToken).toHaveBeenCalledWith('access-new');
    expect(exporter).toHaveBeenNthCalledWith(2, expect.objectContaining({ accessToken: 'access-new' }));
  });

  it('does not start export if token acquisition completes after replacement', async () => {
    const { controller, actions, getValidToken } = setup();
    await controller.signIn({ email: actor.email, password: 'secret' });
    let complete!: (token: string) => void;
    getValidToken.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const exporter = jest.spyOn(reportFileExporter, 'export');
    const pending = actions.exportReportsFile();
    await controller.signOut();
    complete('access-a');
    expect(await pending).toEqual({ kind: 'failed', retryable: false, reason: 'token-unavailable' });
    expect(exporter).not.toHaveBeenCalled();
  });
});
