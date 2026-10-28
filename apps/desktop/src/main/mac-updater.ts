import { writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import electronUpdater from "electron-updater";
import type { DownloadUpdateOptions } from "electron-updater/out/AppUpdater";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor.js";
import { stageMacUpdate, startMacInstaller } from "./mac-update-installer";

export class AdHocMacUpdater extends electronUpdater.AppUpdater {
  private readonly bundle: string;
  private downloaded: { file: string; version: string; sha512: string } | undefined;
  private installing = false;

  constructor(bundle: string) {
    super(undefined);
    this.bundle = bundle;
  }

  protected override async doDownloadUpdate(options: DownloadUpdateOptions): Promise<string[]> {
    const { info, provider } = options.updateInfoAndProvider;
    const file = provider.resolveFiles(info).find(({ url }) => url.pathname.endsWith(`-${process.arch}-mac.zip`));
    if (!file) throw new Error("No matching macOS update archive is available.");
    return this.executeDownload({
      fileExtension: "zip", fileInfo: file, downloadUpdateOptions: options,
      task: (destination, downloadOptions) => new ElectronHttpExecutor().download(file.url, destination, downloadOptions),
      done: async event => {
        this.downloaded = { file: event.downloadedFile, version: event.version, sha512: file.info.sha512 };
        this.dispatchUpdateDownloaded(event);
      },
    });
  }

  override quitAndInstall(): void {
    if (this.installing || !this.downloaded) return;
    this.installing = true;
    void this.install(this.downloaded).catch(error => {
      this.installing = false;
      if (error instanceof Error && "code" in error && error.code === "ERR_DOCK_UPDATE_INVALID") {
        this.downloaded = undefined;
        this.downloadedUpdateHelper = null;
      }
      this.dispatchError(error instanceof Error ? error : new Error("Rivnote could not prepare the update."));
    });
  }

  private async install(downloaded: { file: string; version: string; sha512: string }): Promise<void> {
    const { stage, replacement } = await stageMacUpdate(this.bundle, downloaded.file, downloaded.version, downloaded.sha512);
    try {
      const helper = await startMacInstaller(stage, this.bundle, replacement, app.getPath("userData"), process.argv.slice(1));
      let committed = false;
      const commit = () => {
        writeFileSync(join(stage, "commit"), "", { mode: 0o600 });
        committed = true;
      };
      helper.once("exit", () => {
        app.removeListener("quit", commit);
        if (!committed) {
          this.installing = false;
          this.dispatchError(new Error("The update could not finish shutting down Rivnote."));
        }
      });
      app.once("quit", commit);
      app.quit();
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      throw error;
    }
  }
}
