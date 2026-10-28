import {
  syncFeaturesSchema,
  sharedProjectsResponseSchema,
  deviceSchema,
  privateProjectsSchema,
  privateProjectsResultSchema,
  type SyncFeatures,
  type SyncFeatureCommand,
  syncEndpointSchema,
  syncCredentialsSchema,
  syncSessionSchema,
  syncPullResultSchema,
  syncPushResultSchema,
  syncRecordSchema,
  type SyncCredentials,
  type Command,
  type SyncStatus,
} from "@dock/contracts";
import type { DockDatabase } from "./database.ts";

export type SyncAuthCommand = Extract<
  Command,
  { type: "sync.login" | "sync.signup" }
>;

export type SyncFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect: "error";
    signal: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

class SyncRequestError extends Error {}

export class DockSync {
  private credentials: SyncCredentials | null = null;
  private features: SyncFeatures = syncFeaturesSchema.parse({});
  private phase: SyncStatus["phase"] = "disconnected";
  private error = "";
  private lastSyncedAt: string | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  private readonly database: DockDatabase;
  private readonly changed: () => void;
  private readonly deviceName: string;
  private readonly fetchRequest: SyncFetch;

  constructor(
    database: DockDatabase,
    changed: () => void,
    deviceName: string,
    fetchRequest: SyncFetch = fetch,
  ) {
    this.database = database;
    this.changed = changed;
    this.deviceName = deviceName;
    this.fetchRequest = fetchRequest;
  }

  statusFeatures(): SyncFeatures {
    return this.features;
  }

  status(): SyncStatus {
    return {
      connected: this.credentials !== null,
      endpoint:
        this.credentials?.endpoint ??
        this.database.syncAccount()?.endpoint ??
        "",
      email: this.credentials?.email ?? "",
      phase: this.phase,
      ...this.database.syncCounts(),
      lastSyncedAt: this.lastSyncedAt,
      error: this.error,
    };
  }

  restore(credentials: SyncCredentials): void {
    credentials = syncCredentialsSchema.parse(credentials);
    this.database.bindSyncAccount(credentials.endpoint, credentials.accountId);
    this.credentials = credentials;
    this.phase = "pending";
    this.schedule(0);
  }

  restoreFailed(): void {
    this.phase = "error";
    this.error =
      "Your saved session could not be opened. Sign in again; local changes are safe.";
  }

  async authenticate(command: SyncAuthCommand): Promise<SyncCredentials> {
    if (this.running) await this.running;
    const endpoint = syncEndpointSchema.parse(command.endpoint);
    const bound = this.database.syncAccount();
    if (bound && bound.endpoint !== endpoint)
      throw new Error("Use a separate Rivnote profile for another sync server.");
    const response = await this.request(
      endpoint,
      command.type === "sync.signup" ? "/auth/signup" : "/auth/login",
      null,
      {
        email: command.email,
        password: command.password,
        deviceName: this.deviceName,
      },
    );
    const session = syncSessionSchema.parse(response);
    const recoveryCode = (response as { recoveryCode?: unknown }).recoveryCode;
    if (typeof recoveryCode === "string" && /^[0-9a-f]{64}$/.test(recoveryCode))
      this.features.recoveryCode = recoveryCode;
    this.database.bindSyncAccount(endpoint, session.accountId);
    return { ...session, endpoint };
  }

  async feature(command: SyncFeatureCommand): Promise<SyncCredentials | null> {
    if (this.running) await this.running;
    this.features.error = "";
    try {
      if (command.type === "sync.recover") {
        const endpoint = syncEndpointSchema.parse(command.endpoint);
        const bound = this.database.syncAccount();
        if (bound && bound.endpoint !== endpoint)
          throw new Error(
            "Use the sync server already connected to this workspace.",
          );
        const response = await this.request(endpoint, "/auth/recover", null, {
          ...command,
          expectedAccountId: bound?.accountId,
        });
        const session = syncSessionSchema.parse(response);
        this.database.bindSyncAccount(endpoint, session.accountId);
        const code = (response as { recoveryCode?: unknown }).recoveryCode;
        this.features.recoveryCode = typeof code === "string" ? code : "";
        return { ...session, endpoint };
      }
      const credentials = this.credentials;
      if (!credentials)
        throw new Error(
          "Connect Rivnote Sync before managing your account or shared projects.",
        );
      if (command.type === "sync.recovery.create") {
        const response = await this.request(
          credentials.endpoint,
          "/auth/recovery",
          credentials.token,
          {},
        );
        const code = (response as { recoveryCode?: unknown }).recoveryCode;
        if (typeof code !== "string" || !/^[0-9a-f]{64}$/.test(code))
          throw new Error("The sync server returned an invalid recovery code.");
        this.features.recoveryCode = code;
      } else if (command.type === "sync.devices") {
        await this.refreshDevices(credentials);
      } else if (command.type === "sync.device.revoke") {
        await this.request(
          credentials.endpoint,
          "/auth/revoke",
          credentials.token,
          { id: command.id },
        );
        await this.refreshDevices(credentials);
      } else {
        const path =
          command.type === "sync.project.share"
            ? "/projects"
            : command.type === "sync.project.invite"
              ? "/projects/invite"
              : "/projects/remove";
        await this.request(
          credentials.endpoint,
          path,
          credentials.token,
          command,
        );
        await this.refreshProjects(credentials);
        this.localChanged();
      }
      this.changed();
      return null;
    } catch (error) {
      this.features.error =
        error instanceof Error ? error.message : "The sync request failed.";
      this.changed();
      throw error;
    }
  }

  private async refreshDevices(credentials: SyncCredentials): Promise<void> {
    const response = (await this.request(
      credentials.endpoint,
      "/auth/devices",
      credentials.token,
    )) as { devices?: unknown };
    this.features.devices = deviceSchema.array().parse(response.devices);
  }

  private async refreshProjects(credentials: SyncCredentials): Promise<void> {
    const known = this.features.projects.map((project) => project.id).join(",");
    const response = sharedProjectsResponseSchema.parse(
      await this.request(
        credentials.endpoint,
        `/projects?known=${encodeURIComponent(known)}`,
        credentials.token,
      ),
    );
    this.database.applySharedProjects(
      response.projects,
      response.projects.map((project) => project.id),
    );
    this.database.applySync(
      response.records.map((record) => syncRecordSchema.parse(record)),
    );
    this.features.projects = response.projects;
  }

  private async refreshPrivateProjects(
    credentials: SyncCredentials,
  ): Promise<void> {
    const remote = privateProjectsSchema.parse(
      await this.request(credentials.endpoint, "/workspace", credentials.token),
    );
    this.database.applyPrivateProjects(remote.projects, remote.version);
    const local = this.database.projectSyncState();
    if (!local.dirty) return;
    const result = privateProjectsResultSchema.parse(
      await this.request(
        credentials.endpoint,
        "/workspace",
        credentials.token,
        {
          projects: local.projects,
          baseVersion: local.version,
          mutationId: local.mutationId,
        },
      ),
    );
    if (result.accepted)
      this.database.acknowledgeProjects(local.mutationId, result.version);
    this.database.applyPrivateProjects(result.projects, result.version);
  }

  localChanged(notify = true): void {
    if (!this.credentials) return;
    if (this.phase !== "syncing") this.phase = "pending";
    if (notify) this.changed();
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
    this.running = this.exchange(credentials).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async exchange(credentials: SyncCredentials): Promise<void> {
    this.phase = "syncing";
    this.error = "";
    this.changed();
    let hasMore = false;
    try {
      await this.refreshProjects(credentials);
      await this.refreshPrivateProjects(credentials);
      const pull = syncPullResultSchema.parse(
        await this.request(
          credentials.endpoint,
          `/sync?cursor=${this.database.syncCursor()}`,
          credentials.token,
        ),
      );
      this.database.applySync(pull.changes, pull.cursor);
      hasMore = pull.hasMore;
      if (!hasMore) {
        for (const mutation of this.database.pendingChanges()) {
          const push = syncPushResultSchema.parse(
            await this.request(
              credentials.endpoint,
              "/sync",
              credentials.token,
              mutation,
            ),
          );
          if (push.current.item.id !== mutation.item.id)
            throw new Error("The sync server returned the wrong item.");
          if (push.accepted)
            this.database.acknowledgeSync(mutation, push.version);
          this.database.applySync([push.current]);
        }
      }
      this.features.error = "";
      this.lastSyncedAt = new Date().toISOString();
      this.phase =
        this.database.syncCounts().pending ||
        this.database.projectSyncState().dirty ||
        hasMore
          ? "pending"
          : "synced";
    } catch (error) {
      const offline =
        error instanceof Error &&
        ["TypeError", "TimeoutError", "AbortError"].includes(error.name);
      this.phase = offline ? "offline" : "error";
      this.error =
        error instanceof SyncRequestError
          ? error.message
          : error instanceof Error && error.name === "ZodError"
            ? "The sync server returned an incompatible response. Your local changes are safe."
            : offline
              ? "Could not reach the sync server. Changes are saved locally and will retry automatically."
              : "Sync needs attention. Your local changes are safe; try again or reconnect.";
    } finally {
      if (!this.stopped) {
        this.changed();
        this.schedule(this.phase === "pending" ? 100 : 15_000);
      }
    }
  }

  private async request(
    endpoint: string,
    path: string,
    token: string | null,
    body?: unknown,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetchRequest(`${endpoint}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        if (typeof detail?.error === "string" && detail.error.length <= 500)
          throw new SyncRequestError(detail.error);
        const messages: Record<number, string> = {
          401: token
            ? "Your session expired or was revoked. Sign in again; local changes are safe."
            : "Email or password is incorrect.",
          403: "The invite code is incorrect.",
          409: "Unable to create this account. Try signing in.",
          429: "Too many sign-in attempts. Try again in a minute.",
        };
        throw new SyncRequestError(
          messages[response.status] ??
            "The sync server could not complete this request. Local changes are safe.",
        );
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async disconnect(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) await this.running;
    clearTimeout(this.timer);
    const credentials = this.credentials;
    this.credentials = null;
    this.features = syncFeaturesSchema.parse({});
    this.phase = "disconnected";
    this.error = "";
    this.changed();
    if (credentials) {
      try {
        await this.request(
          credentials.endpoint,
          "/auth/logout",
          credentials.token,
          {},
        );
      } catch {
        /* Local disconnect works offline; the server session expires after 30 days. */
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.running) await this.running;
  }
}
