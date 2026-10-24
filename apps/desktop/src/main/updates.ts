import { updateStateSchema, type UpdateState } from "@dock/contracts";
import type { AppUpdater } from "electron-updater";
import type { AppUpdaterEvents } from "electron-updater/out/AppUpdater";

export type UpdateBackend = Pick<AppUpdater,
  "autoDownload" | "autoInstallOnAppQuit" | "allowDowngrade" | "allowPrerelease" |
  "checkForUpdates" | "downloadUpdate" | "quitAndInstall"> & {
    on<Event extends keyof AppUpdaterEvents>(event: Event, listener: AppUpdaterEvents[Event]): unknown;
  };

export class DockUpdates {
  private current: UpdateState;
  private automatic = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;
  private readonly backend: UpdateBackend | null;
  private readonly changed: () => void;
  private readonly beforeInstall: () => Promise<void>;

  constructor(
    backend: UpdateBackend | null,
    changed: () => void,
    beforeInstall: () => Promise<void>,
  ) {
    this.backend = backend;
    this.changed = changed;
    this.beforeInstall = beforeInstall;
    this.current = updateStateSchema.parse({
      status: backend ? "idle" : "unavailable",
      message: backend ? "" : "Updates are available in installed macOS, Windows, and Linux AppImage builds.",
    });
    if (!backend) return;
    backend.autoDownload = false;
    backend.autoInstallOnAppQuit = false;
    backend.allowDowngrade = false;
    backend.allowPrerelease = false;
    backend.on("checking-for-update", () => this.set("checking"));
    backend.on("update-not-available", () => this.set("current"));
    backend.on("update-available", info => this.set("available", { version: info.version }));
    backend.on("download-progress", info => {
      if (this.current.status === "downloading" && Number.isFinite(info.percent))
        this.set("downloading", { version: this.current.version, progress: Math.min(100, Math.max(0, info.percent)) });
    });
    backend.on("update-downloaded", info => this.set("ready", { version: info.version, progress: 100 }));
    backend.on("error", error => this.fail(error));
  }

  state(): UpdateState { return this.current; }

  configure(automatic: boolean): void {
    if (this.stopped || !this.backend) return;
    this.automatic = automatic;
    clearInterval(this.timer);
    this.timer = undefined;
    if (!automatic) return;
    this.timer = setInterval(() => void this.check(), 6 * 60 * 60 * 1000);
    this.timer.unref();
    if (this.current.status === "available") void this.download();
    else void this.check();
  }

  check(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.stopped || !this.backend || ["available", "downloading", "ready", "installing"].includes(this.current.status))
      return Promise.resolve();
    return this.run(async () => { await this.backend!.checkForUpdates(); });
  }

  download(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.stopped || !this.backend ||
        !(this.current.status === "available" || (this.current.status === "error" && this.current.retry === "download")))
      return Promise.resolve();
    this.set("downloading", { version: this.current.version });
    return this.run(async () => { await this.backend!.downloadUpdate(); });
  }

  async install(): Promise<void> {
    if (this.stopped || !this.backend || this.inFlight ||
        !(this.current.status === "ready" || (this.current.status === "error" && this.current.retry === "install"))) return;
    this.set("installing", { version: this.current.version, progress: 100 });
    try {
      await this.beforeInstall();
    } catch (error) {
      this.set("error", { version: this.current.version, retry: "install",
        message: error instanceof Error ? error.message.replace(/^Error: /, "") : "Finish your drafts before restarting Dock." });
      return;
    }
    try { this.backend.quitAndInstall(false, true); }
    catch (error) { this.fail(error); }
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
  }

  private set(status: UpdateState["status"], details: Partial<UpdateState> = {}): void {
    if (this.stopped) return;
    this.current = updateStateSchema.parse({ status, ...details });
    this.changed();
  }

  private fail(error: unknown): void {
    if (this.stopped) return;
    if (error instanceof Error && "code" in error && error.code === "ERR_UPDATER_LATEST_VERSION_NOT_FOUND") {
      this.set("current", { message: "No update releases have been published yet." });
      return;
    }
    console.error("Dock update failed:", error);
    const invalidDownload = error instanceof Error && "code" in error && error.code === "ERR_DOCK_UPDATE_INVALID";
    const retry = invalidDownload ? "download" : this.current.status === "installing" ? "install" :
      this.current.status === "downloading" ? "download" : this.current.retry;
    this.set("error", { version: this.current.version, retry,
      message: invalidDownload ? "The downloaded update could not be verified. Download it again." :
        retry === "install" ? "The update could not be installed. Try again." :
        retry === "download" ? "The update could not be downloaded. Try again." : "Updates could not be checked. Try again." });
  }

  private run(operation: () => Promise<void>): Promise<void> {
    const pending = operation().catch(error => {
      if (this.current.status !== "error") this.fail(error);
    }).finally(() => {
      this.inFlight = undefined;
      if (this.automatic && this.current.status === "available") void this.download();
    });
    this.inFlight = pending;
    return pending;
  }
}
