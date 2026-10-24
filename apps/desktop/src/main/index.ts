import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  screen,
  safeStorage,
  shell,
  Tray,
} from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import electronUpdater from "electron-updater";
import {
  parseCommand,
  syncCredentialsSchema,
  type Command,
  type Snapshot,
  type WindowRole,
} from "@dock/contracts";
import { DockDatabase } from "./database";
import { startLocalApi } from "./local-api";
import { checkReminders } from "./reminders";
import { DockSync } from "./sync";
import { DockUpdates } from "./updates";
import { isAdHocMacBundle } from "./mac-update-installer";
import { AdHocMacUpdater } from "./mac-updater";

app.setName("Dock");
const dataDirectory =
  process.env.DOCK_DATA_DIR ?? join(app.getPath("appData"), "Dock");
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
app.setPath("userData", dataDirectory);
app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");

const windows = new Map<WindowRole, BrowserWindow>();
let database: DockDatabase;
let sync: DockSync;
let updates: DockUpdates;
let syncStopped = false;
const sessionPath = join(dataDirectory, "sync-session.bin");
let tray: Tray | null = null;
let quitting = false;
let shortcutRegistered = false;
let notificationError = "";
let reminderTimer: ReturnType<typeof setInterval> | undefined;
let stopLocalApi: (() => void) | undefined;
const topmostSupported = !(
  process.platform === "linux" && process.env.XDG_SESSION_TYPE === "wayland"
);

function snapshot(): Snapshot {
  return {
    ...database.snapshot(),
    sync: sync.status(),
    update: updates.state(),
    system: {
      platform: process.platform,
      version: app.getVersion(),
      dataPath: join(app.getPath("userData"), "dock.sqlite"),
      shortcutRegistered,
      topmostSupported,
      trayAvailable: tray !== null,
      notificationsSupported: Notification.isSupported(),
      launchAtLoginSupported: app.isPackaged && process.platform !== "linux",
      notificationError,
      miniOpen: Boolean(windows.get("mini")?.isVisible()),
    },
  };
}

function broadcast(): void {
  const state = snapshot();
  for (const window of windows.values())
    window.webContents.send("dock:changed", state);
}

async function openWindow(role: WindowRole): Promise<BrowserWindow> {
  const existing = windows.get(role);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    if (role === "capture") existing.webContents.send("dock:capture");
    broadcast();
    return existing;
  }
  const size =
    role === "main"
      ? { width: 780, height: 600, minWidth: 680, minHeight: 480 }
      : role === "capture"
        ? { width: 420, height: 224, minWidth: 380, minHeight: 180 }
        : { width: 360, height: 460, minWidth: 320, minHeight: 320 };
  const window = new BrowserWindow({
    ...size,
    show: false,
    frame: process.platform === "darwin" && role !== "capture",
    ...(process.platform === "darwin"
      ? role === "capture"
        ? { type: "panel" }
        : {
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 16, y: 17 },
            titleBarOverlay: true,
          }
      : {}),
    title: role === "main" ? "Dock" : `Dock ${role}`,
    icon: join(__dirname, "../../resources/app-icon.png"),
    backgroundColor:
      database.snapshot().settings.theme === "dark" ? "#202827" : "#ffffff",
    resizable: role !== "capture",
    alwaysOnTop: role === "mini" && topmostSupported && database.snapshot().settings.miniPinned,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform === "darwin" && role !== "capture")
    window.setWindowButtonVisibility(true);
  if (role === "capture" && topmostSupported)
    window.setAlwaysOnTop(database.snapshot().settings.capturePinned);
  if (role === "mini")
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  windows.set(role, window);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (URL.canParse(url) && ["http:", "https:", "mailto:"].includes(new URL(url).protocol))
      void shell.openExternal(url).catch(error => console.error("Dock could not open link:", error));
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("close", (event) => {
    if (quitting) return;
    if (
      role === "capture" ||
      (role === "main" && tray && database.snapshot().settings.closeToTray)
    ) {
      event.preventDefault();
      window.hide();
    } else if (role === "main") {
      app.quit();
    }
  });
  window.on("closed", () => {
    windows.delete(role);
    if (!quitting) broadcast();
  });
  if (role === "capture") {
    const cursor = screen.getCursorScreenPoint();
    const bounds = screen.getDisplayNearestPoint(cursor).workArea;
    window.setPosition(
      Math.round(bounds.x + (bounds.width - size.width) / 2),
      Math.round(bounds.y + bounds.height * 0.22),
    );
  }
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    const url = new URL(rendererUrl);
    url.searchParams.set("window", role);
    await window.loadURL(url.toString());
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"), {
      query: { window: role },
    });
  }
  window.show();
  window.focus();
  broadcast();
  return window;
}

function showNotification(title: string, body: string): boolean {
  if (!Notification.isSupported()) return false;
  const notification = new Notification({ title, body, silent: false });
  notification.on("click", () => void openWindow("main"));
  notification.on("failed", (_event, error) => {
    notificationError = String(error);
    broadcast();
  });
  notification.on("show", () => {
    if (notificationError) {
      notificationError = "";
      broadcast();
    }
  });
  notification.show();
  return true;
}

function tick(): void {
  try {
    checkReminders(database, (item) =>
      showNotification("Dock reminder", item.title),
    );
  } catch (error) {
    console.error("Dock reminder check failed:", error);
  }
}

async function dispatch(
  command: Command,
  sender?: BrowserWindow,
): Promise<Snapshot> {
  if (command.type === "update") {
    if (!sender) throw new Error("App updates require the desktop UI.");
    await updates[command.action]();
  } else if (command.type === "capture.resize") {
    if (!sender || sender !== windows.get("capture"))
      throw new Error("Only quick capture can resize its panel.");
    const bounds = sender.getBounds();
    const height = Math.min(command.height, screen.getDisplayMatching(bounds).workArea.height);
    if (bounds.height !== height) sender.setSize(bounds.width, height);
    return snapshot();
  } else if (command.type === "sync.login" || command.type === "sync.signup") {
    if (!safeStorage.isEncryptionAvailable() ||
        (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text"))
      throw new Error("Secure credential storage is unavailable. Enable your system keychain before signing in.");
    const credentials = await sync.authenticate(command);
    writeFileSync(`${sessionPath}.tmp`, safeStorage.encryptString(JSON.stringify(credentials)), { mode: 0o600 });
    renameSync(`${sessionPath}.tmp`, sessionPath);
    sync.restore(credentials);
  } else if (command.type === "sync.now") {
    await sync.sync();
  } else if (command.type === "sync.disconnect") {
    if (existsSync(sessionPath)) unlinkSync(sessionPath);
    await sync.disconnect();
  } else if (command.type === "window") {
    if (["main", "capture", "mini"].includes(command.action)) {
      await openWindow(command.action as WindowRole);
    } else if (command.action === "export") {
      const result = await dialog.showSaveDialog({
        title: "Export Dock data",
        defaultPath: "dock-backup.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!result.canceled && result.filePath)
        writeFileSync(
          result.filePath,
          JSON.stringify(database.snapshot(), null, 2),
        );
    } else if (command.action === "test-notification") {
      if (!showNotification("Dock", "Your reminders will appear here."))
        throw new Error(
          "Desktop notifications are unavailable on this system.",
        );
    } else if (sender) {
      if (command.action === "hide") sender.hide();
      if (command.action === "minimize") sender.minimize();
      if (command.action === "maximize")
        sender.isMaximized() ? sender.unmaximize() : sender.maximize();
      if (command.action === "close") sender.close();
      if (command.action === "quit") app.quit();
    }
  } else if (command.type === "settings.save") {
    const previous = database.snapshot().settings;
    const changed = previous.shortcut !== command.settings.shortcut;
    if (
      changed &&
      !globalShortcut.register(
        command.settings.shortcut,
        () => void openWindow("capture"),
      )
    ) {
      throw new Error(
        "That shortcut is unavailable. Your previous shortcut is still active.",
      );
    }
    if (
      command.settings.launchAtLogin &&
      !snapshot().system.launchAtLoginSupported
    ) {
      if (changed) globalShortcut.unregister(command.settings.shortcut);
      throw new Error(
        "Launch at login is available in packaged macOS and Windows builds.",
      );
    }
    try {
      database.execute(command);
    } catch (error) {
      if (changed) globalShortcut.unregister(command.settings.shortcut);
      throw error;
    }
    if (topmostSupported && previous.capturePinned !== command.settings.capturePinned)
      windows.get("capture")?.setAlwaysOnTop(command.settings.capturePinned);
    if (topmostSupported && previous.miniPinned !== command.settings.miniPinned)
      windows.get("mini")?.setAlwaysOnTop(command.settings.miniPinned);
    if (changed) {
      globalShortcut.unregister(previous.shortcut);
      shortcutRegistered = true;
    }
    if (snapshot().system.launchAtLoginSupported && previous.launchAtLogin !== command.settings.launchAtLogin)
      app.setLoginItemSettings({ openAtLogin: command.settings.launchAtLogin });
    if (previous.automaticUpdates !== command.settings.automaticUpdates)
      updates.configure(command.settings.automaticUpdates);
  } else {
    database.execute(command);
    if (command.type.startsWith("item.")) sync.localChanged();
  }
  if (command.type !== "snapshot") broadcast();
  return snapshot();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => void openWindow("main"));
  app
    .whenReady()
    .then(async () => {
      const directory = app.getPath("userData");
      mkdirSync(directory, { recursive: true });
      database = new DockDatabase(join(directory, "dock.sqlite"));
      sync = new DockSync(database, broadcast);
      const supported = app.isPackaged && (process.platform !== "linux" || !!process.env.APPIMAGE);
      const bundle = resolve(process.resourcesPath, "../..");
      const backend = !supported ? null : process.platform === "darwin" && isAdHocMacBundle(bundle)
        ? new AdHocMacUpdater(bundle) : electronUpdater.autoUpdater;
      updates = new DockUpdates(backend, () => {
        if (updates.state().status === "error") quitting = false;
        broadcast();
      }, async () => {
        await Promise.all([...windows.values()].map(window => window.webContents.executeJavaScript("window.dock.prepareUpdate()")));
        quitting = true;
      });
      if (existsSync(sessionPath)) {
        try {
          sync.restore(syncCredentialsSchema.parse(JSON.parse(safeStorage.decryptString(readFileSync(sessionPath)))));
        } catch {
          sync.restoreFailed();
        }
      }
      ipcMain.handle("dock:command", async (event, input: unknown) => {
        const sender = [...windows.values()].find(
          (window) => window.webContents === event.sender,
        );
        if (!sender || event.senderFrame !== sender.webContents.mainFrame)
          throw new Error("Unknown command sender.");
        return dispatch(parseCommand(input), sender);
      });
      stopLocalApi = await startLocalApi(directory, (command) =>
        dispatch(command),
      );
      const settings = database.snapshot().settings;
      shortcutRegistered = globalShortcut.register(
        settings.shortcut,
        () => void openWindow("capture"),
      );
      const icon = nativeImage.createFromPath(
        join(__dirname, "../../resources/icon.png"),
      );
      try {
        tray = new Tray(icon.resize({ width: 22, height: 22 }));
        tray.setToolTip("Dock — tasks and notes");
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: "Open Dock", click: () => void openWindow("main") },
            { label: "Quick capture", click: () => void openWindow("capture") },
            { label: "Mini window", click: () => void openWindow("mini") },
            { type: "separator" },
            { label: "Quit Dock", click: () => app.quit() },
          ]),
        );
        tray.on("click", () => void openWindow("main"));
      } catch (error) {
        console.error("Dock tray unavailable:", error);
      }
      await openWindow("main");
      if (settings.openMiniAtStartup) await openWindow("mini");
      updates.configure(settings.automaticUpdates);
      reminderTimer = setInterval(tick, 15_000);
      powerMonitor.on("resume", tick);
      tick();
    })
    .catch((error) => {
      dialog.showErrorBox(
        "Dock could not start",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
  app.on("activate", () => void openWindow("main"));
  app.on("window-all-closed", () => {
    if (!tray) app.quit();
  });
  app.on("before-quit", (event) => {
    quitting = true;
    updates?.stop();
    if (sync && !syncStopped) {
      event.preventDefault();
      syncStopped = true;
      void sync.stop().finally(() => app.quit());
    }
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (reminderTimer) clearInterval(reminderTimer);
    stopLocalApi?.();
    database?.close();
    tray?.destroy();
  });
}
