import {
  syncEndpointSchema, syncSessionSchema, syncPullResultSchema, syncPushResultSchema,
  type SyncCredentials,
  type Command, type SyncStatus,
} from "@dock/contracts";
import type { DockDatabase } from "./database.ts";

export type SyncAuthCommand = Extract<Command, { type: "sync.login" | "sync.signup" }>;

class SyncRequestError extends Error {}

export class DockSync {
  private credentials: SyncCredentials | null = null;
  private phase: SyncStatus["phase"] = "disconnected";
  private error = "";
  private lastSyncedAt: string | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  private readonly database: DockDatabase;
  private readonly changed: () => void;

  constructor(database: DockDatabase, changed: () => void) {
    this.database = database;
    this.changed = changed;
  }

  status(): SyncStatus {
    return {
      connected: this.credentials !== null,
      endpoint: this.credentials?.endpoint ?? this.database.syncAccount()?.endpoint ?? "",
      email: this.credentials?.email ?? "",
      phase: this.phase,
      ...this.database.syncCounts(),
      lastSyncedAt: this.lastSyncedAt,
      error: this.error,
    };
  }

  restore(credentials: SyncCredentials): void {
    this.database.bindSyncAccount(credentials.endpoint, credentials.accountId);
    this.credentials = credentials;
    this.phase = "pending";
    this.schedule(0);
  }

  restoreFailed(): void {
    this.phase = "error";
    this.error = "Your saved session could not be opened. Sign in again; local changes are safe.";
  }

  async authenticate(command: SyncAuthCommand): Promise<SyncCredentials> {
    if (this.running) await this.running;
    const endpoint = syncEndpointSchema.parse(command.endpoint);
    const bound = this.database.syncAccount();
    if (bound && bound.endpoint !== endpoint)
      throw new Error("Use a separate Dock profile for another sync server.");
    const response = await this.request(endpoint, command.type === "sync.signup" ? "/auth/signup" : "/auth/login", null,
      { email: command.email, password: command.password, ...(command.type === "sync.signup" ? { inviteCode: command.inviteCode } : {}) });
    const session = syncSessionSchema.parse(response);
    this.database.bindSyncAccount(endpoint, session.accountId);
    return { ...session, endpoint };
  }

  localChanged(): void {
    if (!this.credentials) return;
    if (this.phase !== "syncing") this.phase = "pending";
    this.changed();
    this.schedule(500);
  }

  private schedule(delay: number): void {
    if (this.stopped || !this.credentials) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync(), delay);
  }

  sync(): Promise<void> {
    if (this.running) return this.running;
    if (!this.credentials || this.stopped) return Promise.resolve();
    const credentials = this.credentials;
    this.running = this.exchange(credentials).finally(() => { this.running = null; });
    return this.running;
  }

  private async exchange(credentials: SyncCredentials): Promise<void> {
    this.phase = "syncing";
    this.error = "";
    this.changed();
    let hasMore = false;
    try {
      const pull = syncPullResultSchema.parse(await this.request(credentials.endpoint,
        `/sync?cursor=${this.database.syncCursor()}`, credentials.token));
      this.database.applySync(pull.changes, pull.cursor);
      hasMore = pull.hasMore;
      if (!hasMore) {
        for (const mutation of this.database.pendingChanges()) {
          const push = syncPushResultSchema.parse(await this.request(credentials.endpoint, "/sync", credentials.token, mutation));
          if (push.current.item.id !== mutation.item.id) throw new Error("The sync server returned the wrong item.");
          if (push.accepted) this.database.acknowledgeSync(mutation, push.version);
          this.database.applySync([push.current]);
        }
      }
      this.lastSyncedAt = new Date().toISOString();
      this.phase = this.database.syncCounts().pending || hasMore ? "pending" : "synced";
    } catch (error) {
      const offline = error instanceof Error && ["TypeError", "TimeoutError", "AbortError"].includes(error.name);
      this.phase = offline ? "offline" : "error";
      this.error = error instanceof SyncRequestError ? error.message :
        (error instanceof Error && error.name === "ZodError") ? "The sync server returned an incompatible response. Your local changes are safe." :
        offline ? "Could not reach the sync server. Changes are saved locally and will retry automatically." :
        "Sync needs attention. Your local changes are safe; try again or reconnect.";
    } finally {
      if (!this.stopped) {
        this.changed();
        this.schedule(this.phase === "pending" ? 100 : 15_000);
      }
    }
  }

  private async request(endpoint: string, path: string, token: string | null, body?: unknown): Promise<unknown> {
    const response = await fetch(`${endpoint}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: token ? "Your session expired or was revoked. Sign in again; local changes are safe." : "Email or password is incorrect.",
        403: "The invite code is incorrect.",
        409: "Unable to create this account. Try signing in.",
        429: "Too many sign-in attempts. Try again in a minute.",
      };
      throw new SyncRequestError(messages[response.status] ?? "The sync server could not complete this request. Local changes are safe.");
    }
    return response.json();
  }

  async disconnect(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) await this.running;
    clearTimeout(this.timer);
    const credentials = this.credentials;
    this.credentials = null;
    this.phase = "disconnected";
    this.error = "";
    this.changed();
    if (credentials) {
      try { await this.request(credentials.endpoint, "/auth/logout", credentials.token, {}); }
      catch { /* Local disconnect works offline; the server session expires after 30 days. */ }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.running) await this.running;
  }
}
