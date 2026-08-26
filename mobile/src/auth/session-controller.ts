import type { MobileActor, MobileLoginInput, MobileTokenPair } from '../api/contracts';
import type { ApiClientError } from '../api/client';
import { MemoryTokenStore, type SecureTokenStore, type StoredTokens } from './token-store';

export type { SecureTokenStore, StoredTokens } from './token-store';

export interface SessionApi {
  login(input: MobileLoginInput): Promise<MobileTokenPair & { actor: MobileActor }>;
  refresh(refreshToken: string): Promise<MobileTokenPair>;
  getMe(): Promise<MobileActor>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
}

/**
 * Full lifecycle machine from the implementation plan:
 * `booting`, `signed-out`, `signing-in`, `refreshing`, `signed-in`,
 * `pending-approval`, `offline`, `fatal`.
 */
export type SessionState =
  | { status: 'booting' }
  | { status: 'signed-out'; baseUrl: string | null; message?: string }
  | { status: 'signing-in' }
  | { status: 'refreshing'; previous: SessionState }
  | { status: 'signed-in'; actor: MobileActor; accessToken: string; tokens: StoredTokens; baseUrl: string | null }
  | { status: 'pending-approval'; actor: MobileActor; accessToken: string; tokens: StoredTokens; baseUrl: string | null }
  | { status: 'offline'; baseUrl: string | null; message: string }
  | { status: 'fatal'; message: string };

/** Refresh when the access token has this little validity left. */
const EXPIRY_SKEW_MS = 30_000;

function isTransient(reason: unknown): boolean {
  const code = reason instanceof Error ? (reason as ApiClientError).code : undefined;
  return code === 'NETWORK_ERROR' || code === 'TIMEOUT';
}

function describeFailure(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message;
  return 'The request failed.';
}

type AuthedState = Extract<SessionState, { status: 'signed-in' | 'pending-approval' }>;

export class SessionController {
  private state: SessionState = { status: 'booting' };
  private refreshPromise: Promise<string> | null = null;
  private accessTokenExpiresAt = 0;
  /** Approved server base URL, stamped into persisted tokens. */
  private baseUrl: string | null = null;
  private readonly listeners = new Set<(state: SessionState) => void>();

  constructor(
    private readonly client: SessionApi,
    private readonly store: SecureTokenStore = new MemoryTokenStore(),
  ) {
    this.attachClient();
  }

  /** Wire the API client so protected requests carry and recover the bearer token. */
  private attachClient(): void {
    const withAuth = this.client as unknown as {
      setAuthHooks?: (hooks: {
        getAccessToken(): string | null;
        refreshAccessToken(): Promise<string>;
        onSessionLost(): void;
      }) => void;
    };
    withAuth.setAuthHooks?.({
      getAccessToken: () => (this.isAuthed(this.state) ? this.state.accessToken : null),
      refreshAccessToken: () => this.refreshAccessToken(),
      onSessionLost: () => {
        void this.handleSessionLost();
      },
    });
  }

  getState(): SessionState {
    return this.state;
  }

  /** Records the approved server base URL used for new sign-ins. */
  setBaseUrl(url: string | null): void {
    this.baseUrl = url ? url.trim().replace(/\/+$/, '') || null : null;
  }

  getBaseUrl(): string | null {
    if (this.baseUrl) return this.baseUrl;
    if (this.isAuthed(this.state)) return this.state.tokens.baseUrl ?? null;
    if (this.state.status === 'signed-out' || this.state.status === 'offline') return this.state.baseUrl;
    return null;
  }

  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(next: SessionState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  private isAuthed(state: SessionState): state is AuthedState {
    return state.status === 'signed-in' || state.status === 'pending-approval';
  }

  /** Restore a persisted session on cold start. */
  async restore(): Promise<SessionState> {
    let stored: StoredTokens | null;
    try {
      stored = await this.store.read();
    } catch (reason) {
      this.setState({ status: 'fatal', message: describeFailure(reason) });
      return this.state;
    }
    if (!stored) {
      this.setState({ status: 'signed-out', baseUrl: this.baseUrl });
      return this.state;
    }
    if (stored.baseUrl) this.baseUrl = stored.baseUrl;
    try {
      const pair = await this.client.refresh(stored.refreshToken);
      await this.applyPair(pair, stored);
      return this.state;
    } catch (reason) {
      if (isTransient(reason)) {
        // Keep the refresh token so a later retry can recover the session.
        this.setState({ status: 'offline', baseUrl: stored.baseUrl ?? null, message: describeFailure(reason) });
        return this.state;
      }
      await this.store.clear().catch(() => undefined);
      this.setState({ status: 'signed-out', baseUrl: stored.baseUrl ?? null });
      return this.state;
    }
  }

  async signIn(input: MobileLoginInput): Promise<void> {
    this.setState({ status: 'signing-in' });
    let result: Awaited<ReturnType<SessionApi['login']>>;
    try {
      result = await this.client.login(input);
    } catch (reason) {
      this.setState({ status: 'signed-out', baseUrl: this.baseUrl, message: describeFailure(reason) });
      throw reason;
    }
    const tokens: StoredTokens = {
      refreshToken: result.refreshToken,
      sessionId: result.sessionId,
      ...(this.baseUrl ? { baseUrl: this.baseUrl } : {}),
    };
    try {
      // Persist before login is considered complete.
      await this.store.write(tokens);
    } catch (reason) {
      // Never keep a session we cannot protect: revoke it server-side.
      await this.store.clear().catch(() => undefined);
      await this.client.logout().catch(() => undefined);
      const message = describeFailure(reason);
      this.setState({ status: 'signed-out', baseUrl: this.baseUrl, message });
      throw new Error(message);
    }
    this.accessTokenExpiresAt = Date.parse(result.accessTokenExpiresAt);
    this.setSignedIn(result.actor, result.accessToken, tokens);
  }

  /**
   * Single-flight access-token refresh shared by all concurrent callers.
   * The `refreshing` state is only announced when no signed-in screen can
   * stay visible (cold start / offline recovery) to avoid UI flicker.
   */
  async refreshAccessToken(): Promise<string> {
    if (!this.refreshPromise) {
      const announce = !this.isAuthed(this.state);
      const previous = this.state;
      if (announce) this.setState({ status: 'refreshing', previous });
      this.refreshPromise = this.performRefresh()
        .catch((reason: unknown) => {
          if (announce && this.state.status === 'refreshing') this.setState(previous);
          throw reason;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }
    return this.refreshPromise;
  }

  /** Returns a usable access token, refreshing first when near expiry or offline. */
  async ensureAccessToken(): Promise<string> {
    if (this.isAuthed(this.state) && this.state.status !== 'pending-approval') {
      const stillValid =
        Number.isFinite(this.accessTokenExpiresAt) &&
        this.accessTokenExpiresAt - EXPIRY_SKEW_MS > Date.now();
      if (stillValid) return this.state.accessToken;
      return this.refreshAccessToken();
    }
    if (this.state.status === 'offline') {
      const recovered = await this.restore();
      if (this.isAuthed(recovered)) return recovered.accessToken;
      throw new Error('No authenticated session is available.');
    }
    throw new Error('No authenticated session is available.');
  }

  async signOut(): Promise<void> {
    await this.revokeLocally(() => this.client.logout());
  }

  /** Revoke every mobile session for this actor on every device. */
  async signOutAllDevices(): Promise<void> {
    await this.revokeLocally(() => this.client.logoutAll());
  }

  private async performRefresh(): Promise<string> {
    const stored = await this.store.read();
    if (!stored) throw new Error('No mobile session is available.');
    const pair = await this.client.refresh(stored.refreshToken);
    await this.applyPair(pair, stored);
    return pair.accessToken;
  }

  private async applyPair(pair: MobileTokenPair, previous: StoredTokens): Promise<void> {
    const tokens: StoredTokens = {
      refreshToken: pair.refreshToken,
      sessionId: pair.sessionId || previous.sessionId,
      ...(previous.baseUrl ? { baseUrl: previous.baseUrl } : {}),
    };
    await this.store.write(tokens);
    const actor = await this.client.getMe();
    this.accessTokenExpiresAt = Date.parse(pair.accessTokenExpiresAt);
    this.setSignedIn(actor, pair.accessToken, tokens);
  }

  private setSignedIn(actor: MobileActor, accessToken: string, tokens: StoredTokens): void {
    this.setState(
      actor.isActive
        ? { status: 'signed-in', actor, accessToken, tokens, baseUrl: tokens.baseUrl ?? null }
        : { status: 'pending-approval', actor, accessToken, tokens, baseUrl: tokens.baseUrl ?? null },
    );
  }

  private async handleSessionLost(): Promise<void> {
    await this.store.clear().catch(() => undefined);
    this.setState({ status: 'signed-out', baseUrl: this.baseUrl });
  }

  private async revokeLocally(revoke: () => Promise<void>): Promise<void> {
    try {
      await revoke();
    } catch {
      // Local logout must complete even if the server is unreachable.
    }
    await this.store.clear().catch(() => undefined);
    this.setState({ status: 'signed-out', baseUrl: this.baseUrl });
  }
}
