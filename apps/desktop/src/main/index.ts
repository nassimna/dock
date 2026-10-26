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
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import electronUpdater from "electron-updater";
import {
  parseCommand,
  syncCredentialsSchema,
  type Command,
  type Snapshot,
  type StoreSnapshot,
  type WindowRole,
} from "@dock/contracts";
import { DockDatabase } from "./database";
import { startLocalApi } from "./local-api";
import { checkReminders } from "./reminders";
import { LocalServices } from "./local-services";
import { DockSync } from "./sync";
import { DockUpdates } from "./updates";
import { isAdHocMacBundle } from "./mac-update-installer";
import { AdHocMacUpdater } from "./mac-updater";

const appName = "Dock";
app.setName(appName);
const dataDirectory =
  process.env.DOCK_DATA_DIR ?? join(app.getPath("appData"), appName);
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
app.setPath("userData", dataDirectory);
app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");

const windows = new Map<WindowRole, BrowserWindow>();
const floatingPositionPath = join(dataDirectory, "floating-position.json");
let floatingPosition: { x: number; y: number } | null = null;
let floatingPositionTimer: ReturnType<typeof setTimeout> | undefined;
let floatingWanted = false;
let database: DockDatabase;
let sync: DockSync;
let updates: DockUpdates;
let localServices: LocalServices;
let checkingReminders = false;
const activeNotifications = new Set<Notification>();
let syncStopped = false;
const sessionPath = join(dataDirectory, "sync-session.bin");
let tray: Tray | null = null;
let quitting = false;
let preparingQuit = false;
let shortcutRegistered = false;
let notificationError = "";
let reminderTimer: ReturnType<typeof setInterval> | undefined;
let stopLocalApi: (() => void) | undefined;
const topmostSupported = !(
  process.platform === "linux" && process.env.XDG_SESSION_TYPE === "wayland"
);

function snapshot(store: StoreSnapshot = database.snapshot()): Snapshot {
  return {
    ...store,
    sync: sync.status(),
    syncFeatures: sync.statusFeatures(),
    update: updates.state(),
    localServices: localServices.state(),
    system: {
      name: appName,
      platform: process.platform,
      version: app.getVersion(),
      dataPath: join(app.getPath("userData"), "dock.sqlite"),
      shortcutRegistered,
      topmostSupported,
      trayAvailable: tray !== null,
      notificationsSupported: Notification.isSupported(),
      launchAtLoginSupported: app.isPackaged && process.platform !== "linux",
      notificationError,
      miniOpen: Boolean(windows.get("mini")?.isVisible() && !windows.get("mini")?.isMinimized()),
    },
  };
}

function broadcast(state: Snapshot = snapshot()): void {
  for (const window of windows.values())
    window.webContents.send("dock:changed", state);
}

function validCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= 2147483647;
}

function saveFloatingPosition(): void {
  clearTimeout(floatingPositionTimer);
  floatingPositionTimer = undefined;
  if (!floatingPosition) return;
  try {
    writeFileSync(`${floatingPositionPath}.tmp`, JSON.stringify(floatingPosition), { mode: 0o600 });
    renameSync(`${floatingPositionPath}.tmp`, floatingPositionPath);
  } catch (error) { console.error("Dock could not save the floating icon position:", error); }
}

function keepFloatingVisible(): void {
  const floating = windows.get("floating");
  if (!quitting && floatingWanted && floating && database.settings().floating.persistent) {
    if (floating.isMinimized()) floating.restore();
    floating.showInactive();
  }
}

function fitFloating(window: BrowserWindow): void {
  const bounds = window.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  window.setPosition(Math.max(area.x, Math.min(area.x + area.width - bounds.width, bounds.x)),
    Math.max(area.y, Math.min(area.y + area.height - bounds.height, bounds.y)));
}

function showWindow(window: BrowserWindow, role: WindowRole): void {
  if (role === "floating") {
    floatingWanted = true;
    windows.get("mini")?.hide();
  }
  const floating = windows.get("floating");
  if (role === "mini" && floating?.isVisible()) {
    const anchor = floating.getBounds();
    const area = screen.getDisplayMatching(anchor).workArea;
    const { width, height } = window.getBounds();
    const persistent = database.settings().floating.persistent;
    let x = anchor.x + anchor.width - width;
    let y = anchor.y + anchor.height - height;
    if (persistent) {
      x = anchor.x - width - 12;
      if (x < area.x) x = anchor.x + anchor.width + 12;
      if (x + width > area.x + area.width) {
        x = anchor.x + anchor.width - width;
        y = anchor.y - height - 12;
        if (y < area.y) y = anchor.y + anchor.height + 12;
      }
    }
    window.setPosition(
      Math.max(area.x, Math.min(area.x + area.width - width, x)),
      Math.max(area.y, Math.min(area.y + area.height - height, y)),
    );
    if (!persistent) floating.hide();
  }
  if (role === "capture") {
    const bounds = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const { width } = window.getBounds();
    window.setPosition(
      Math.round(bounds.x + (bounds.width - width) / 2),
      Math.round(bounds.y + bounds.height * 0.22),
    );
  }
  if (process.platform === "darwin" && role !== "main") window.showInactive();
  else window.show();
  if (role !== "floating") window.focus();
  if (role === "capture") window.webContents.send("dock:capture");
}

async function openWindow(role: WindowRole, announce = true): Promise<BrowserWindow> {
  const existing = windows.get(role);
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    showWindow(existing, role);
    if (announce && role !== "capture") broadcast();
    return existing;
  }
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const style = database.settings().floating;
  const size =
    role === "main"
      ? { width: Math.min(1160, workArea.width), height: Math.min(780, workArea.height), minWidth: Math.min(780, workArea.width), minHeight: Math.min(560, workArea.height) }
      : role === "capture"
        ? { width: 420, height: 224, minWidth: 380, minHeight: 180 }
        : role === "floating"
          ? { width: style.size + 16, height: style.size + 16 + (style.showHandle ? 18 : 0),
              x: floatingPosition?.x ?? workArea.x + workArea.width - style.size - 40,
              y: floatingPosition?.y ?? workArea.y + workArea.height - style.size - 40 }
          : { width: 360, height: 460, minWidth: 320, minHeight: 320 };
  const window = new BrowserWindow({
    ...size,
    show: false,
    frame: process.platform === "darwin" && role !== "capture" && role !== "floating",
    transparent: role === "floating",
    hasShadow: role !== "floating",
    skipTaskbar: role === "floating",
    minimizable: role !== "floating",
    maximizable: role !== "floating",
    movable: role !== "floating" || !style.locked,
    ...(process.platform === "darwin"
      ? role === "capture" || role === "floating"
        ? { type: "panel" }
        : {
            ...(role === "mini" ? { type: "panel" } : {}),
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 16, y: 17 },
            titleBarOverlay: true,
          }
      : {}),
    title: role === "main" ? appName : `${appName} ${role}`,
    icon: join(__dirname, "../../resources/app-icon.png"),
    backgroundColor: role === "floating" ? "#00000000" :
      database.settings().theme === "dark" ? "#202827" : "#ffffff",
    resizable: role !== "capture" && role !== "floating",
    alwaysOnTop: topmostSupported && (role === "floating" || role === "mini" && database.settings().miniPinned),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform === "darwin" && role !== "capture" && role !== "floating")
    window.setWindowButtonVisibility(true);
  if (role === "capture" && topmostSupported)
    window.setAlwaysOnTop(database.settings().capturePinned);
  if (role === "mini" || role === "floating")
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (role === "floating") {
    fitFloating(window);
    const { x, y } = window.getBounds();
    floatingPosition = { x, y };
    floatingPositionTimer = setTimeout(saveFloatingPosition, 200);
    window.on("move", () => {
      const { x, y } = window.getBounds();
      floatingPosition = { x, y };
      clearTimeout(floatingPositionTimer);
      floatingPositionTimer = setTimeout(saveFloatingPosition, 200);
    });
    window.on("hide", () => setImmediate(keepFloatingVisible));
    window.webContents.on("context-menu", () => Menu.buildFromTemplate([
      { label: "Show tasks", click: () => void openWindow("mini") },
      { label: "Quick capture", click: () => void openWindow("capture") },
      { label: "Customize icon…", click: async () => { const main = await openWindow("main"); main.webContents.send("dock:navigate", "settings"); } },
      { label: "Reset icon position", click: () => void dispatch({ type: "window", action: "floating-reset" }) },
      { label: `Open ${appName}`, click: () => void openWindow("main") },
      { type: "separator" },
      { label: "Hide floating icon", click: () => { floatingWanted = false; window.hide(); } },
    ]).popup({ window }));
  }
  windows.set(role, window);
  window.on("minimize", () => {
    if (quitting) return;
    if (role === "mini") void openWindow("floating");
    else if (role === "main" || role === "floating") setImmediate(keepFloatingVisible);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (URL.canParse(url) && ["http:", "https:", "mailto:"].includes(new URL(url).protocol))
      void shell.openExternal(url).catch(error => console.error("Dock could not open link:", error));
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("close", (event) => {
    if (quitting) return;
    if (role === "mini" && windows.has("floating")) {
      event.preventDefault();
      void openWindow("floating");
      return;
    }
    if (
      role === "capture" ||
      (role === "main" && tray && database.settings().closeToTray)
    ) {
      event.preventDefault();
      window.hide();
    } else if (role === "main") {
      event.preventDefault();
      app.quit();
    }
  });
  window.on("closed", () => {
    windows.delete(role);
    if (!quitting) broadcast();
  });
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
  showWindow(window, role);
  if (announce && role !== "capture") broadcast();
  return window;
}

function showNotification(title: string, body: string, taskId?: string): Promise<boolean> {
  if (quitting || !Notification.isSupported()) return Promise.resolve(false);
  return new Promise(resolve => {
    const notification = new Notification({ title, body, silent: false,
      actions: taskId ? [{ type: "button", text: "Complete" }, { type: "button", text: "Snooze 10 min" }] : [] });
    activeNotifications.add(notification);
    let settled = false;
    const finish = (shown: boolean, error = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!shown) {
        activeNotifications.delete(notification);
        notification.close();
      }
      notificationError = error;
      if (!quitting) broadcast();
      resolve(shown);
    };
    const timeout = setTimeout(() => finish(false, "The operating system did not confirm displaying the notification. Check Dock’s notification permissions."), 10_000);
    notification.on("click", async () => {
      const main = await openWindow("main");
      if (taskId) main.webContents.send("dock:open-task", taskId);
    });
    notification.on("action", (_event, index) => {
      if (!taskId) return;
      void dispatch(index === 0 ? { type: "item.complete", id: taskId } : { type: "item.snooze", id: taskId, minutes: 10 })
        .catch(error => console.error("Dock reminder action failed:", error));
    });
    notification.once("failed", (_event, error) => finish(false, String(error)));
    notification.once("show", () => finish(true));
    notification.once("close", () => {
      activeNotifications.delete(notification);
      finish(false, "The notification closed before display was confirmed.");
    });
    try { notification.show(); }
    catch (error) { finish(false, error instanceof Error ? error.message : String(error)); }
  });
}

async function tick(): Promise<void> {
  if (checkingReminders || quitting) return;
  checkingReminders = true;
  try {
    const backupChanged = localServices.ensureDailyBackup();
    const remindersChanged = await checkReminders(database, item => showNotification(`${appName} reminder`, item.title, item.id), new Date(), localServices.reminders);
    if (!quitting && (backupChanged || remindersChanged)) broadcast();
  } catch (error) {
    console.error("Dock reminder check failed:", error);
  } finally {
    checkingReminders = false;
  }
}

async function dispatch(
  command: Command,
  sender?: BrowserWindow,
): Promise<Snapshot> {
  let store: StoreSnapshot | undefined;
  if (command.type === "backup.create" || command.type === "backup.restore" || command.type === "backup.import" ||
      command.type === "attachment.add" || command.type === "attachment.open" || command.type === "reminder.retry") {
    if (!sender) throw new Error("Backups, files, and reminder controls require the desktop UI.");
    if (command.type === "backup.create") localServices.createBackup();
    else if (command.type === "backup.restore") {
      localServices.restore(command.name);
      sync.localChanged(false);
    } else if (command.type === "backup.import") {
      const result = await dialog.showOpenDialog(sender, {
        title: command.format === "json" ? "Import Dock backup" : "Import Todoist CSV",
        filters: [{ name: command.format === "json" ? "Dock backup" : "Todoist export", extensions: [command.format === "json" ? "json" : "csv"] }],
        properties: ["openFile"],
      });
      if (!result.canceled && result.filePaths[0]) {
        const filename = result.filePaths[0];
        if (statSync(filename).size > 32 * 1024 * 1024) throw new Error("Import files must be no larger than 32 MB.");
        const content = readFileSync(filename, "utf8");
        if (command.format === "json") localServices.importJson(content);
        else localServices.importTodoist(content, basename(filename, extname(filename)));
        sync.localChanged(false);
      }
    } else if (command.type === "attachment.add") {
      const result = await dialog.showOpenDialog(sender, {
        title: "Attach local files", properties: ["openFile", "multiSelections"],
        filters: [{ name: "Documents and images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md", "csv", "json", "docx", "xlsx", "pptx"] }],
      });
      if (!result.canceled && result.filePaths.length) {
        localServices.addAttachments(command.itemId, result.filePaths, command.commentId);
        sync.localChanged(false);
      }
    } else if (command.type === "attachment.open") {
      const error = await shell.openPath(localServices.attachmentPath(command.id));
      if (error) throw new Error(error);
    } else {
      localServices.reminders.retry(command.key);
      void tick();
    }
  } else if (command.type === "update") {
    if (!sender) throw new Error("App updates require the desktop UI.");
    await updates[command.action]();
  } else if (command.type === "capture.resize") {
    if (!sender || sender !== windows.get("capture"))
      throw new Error("Only quick capture can resize its panel.");
    const bounds = sender.getBounds();
    const height = Math.min(command.height, screen.getDisplayMatching(bounds).workArea.height);
    if (bounds.height !== height) sender.setSize(bounds.width, height);
    return snapshot();
  } else if (command.type === "sync.login" || command.type === "sync.signup" || command.type === "sync.recover") {
    if (!sender) throw new Error("Account actions require the desktop UI.");
    if (!safeStorage.isEncryptionAvailable() ||
        (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text"))
      throw new Error("Secure credential storage is unavailable. Enable your system keychain before signing in.");
    const credentials = command.type === "sync.recover" ? await sync.feature(command) : await sync.authenticate(command);
    if (credentials) {
      writeFileSync(`${sessionPath}.tmp`, safeStorage.encryptString(JSON.stringify(credentials)), { mode: 0o600 });
      renameSync(`${sessionPath}.tmp`, sessionPath);
      sync.restore(credentials);
    }
  } else if (command.type === "sync.now") {
    await sync.sync();
  } else if (command.type === "sync.disconnect") {
    if (existsSync(sessionPath)) unlinkSync(sessionPath);
    await sync.disconnect();
  } else if (command.type === "sync.recovery.create" || command.type === "sync.devices" ||
      command.type === "sync.device.revoke" || command.type === "sync.project.share" ||
      command.type === "sync.project.invite" || command.type === "sync.project.remove") {
    if (!sender) throw new Error("Account actions require the desktop UI.");
    await sync.feature(command);
  } else if (command.type === "window") {
    if (command.action === "floating-reset") {
      const window = await openWindow("floating", false);
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      const { width, height } = window.getBounds();
      window.setPosition(area.x + area.width - width - 24, area.y + area.height - height - 24);
    } else if (["main", "capture", "mini", "floating"].includes(command.action)) {
      const window = await openWindow(command.action as WindowRole, false);
      if (command.action === "main" && command.view) window.webContents.send("dock:navigate", command.view);
    } else if (command.action === "export") {
      const result = await dialog.showSaveDialog({
        title: "Export Dock data",
        defaultPath: "dock-backup.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!result.canceled && result.filePath)
        writeFileSync(
          result.filePath,
          JSON.stringify(database.backup(), null, 2),
        );
    } else if (command.action === "test-notification") {
      if (!await showNotification(appName, "Your reminders will appear here."))
        throw new Error(
          "The operating system did not confirm displaying the test notification. Check Dock’s notification permissions.",
        );
    } else if (sender) {
      if (command.action === "hide") {
        if (sender === windows.get("floating")) floatingWanted = false;
        sender.hide();
      }
      if (command.action === "minimize" && sender !== windows.get("floating")) sender.minimize();
      if (command.action === "maximize")
        sender.isMaximized() ? sender.unmaximize() : sender.maximize();
      if (command.action === "close") sender.close();
      if (command.action === "quit") app.quit();
    }
  } else if (command.type === "settings.save") {
    const previous = database.settings();
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
      store = database.execute(command);
    } catch (error) {
      if (changed) globalShortcut.unregister(command.settings.shortcut);
      throw error;
    }
    if (topmostSupported && previous.capturePinned !== command.settings.capturePinned)
      windows.get("capture")?.setAlwaysOnTop(command.settings.capturePinned);
    if (topmostSupported && previous.miniPinned !== command.settings.miniPinned)
      windows.get("mini")?.setAlwaysOnTop(command.settings.miniPinned);
    const floating = windows.get("floating");
    if (floating) {
      const style = command.settings.floating;
      floating.setSize(style.size + 16, style.size + 16 + (style.showHandle ? 18 : 0));
      floating.setMovable(!style.locked);
      fitFloating(floating);
      if (style.persistent) keepFloatingVisible();
      else if (windows.get("mini")?.isVisible()) floating.hide();
    }
    if (changed) {
      globalShortcut.unregister(previous.shortcut);
      shortcutRegistered = true;
    }
    if (snapshot().system.launchAtLoginSupported && previous.launchAtLogin !== command.settings.launchAtLogin)
      app.setLoginItemSettings({ openAtLogin: command.settings.launchAtLogin });
    if (previous.automaticUpdates !== command.settings.automaticUpdates)
      updates.configure(command.settings.automaticUpdates);
  } else {
    store = database.execute(command);
    if (command.type.startsWith("item.")) sync.localChanged(false);
  }
  const state = snapshot(store);
  if (command.type !== "snapshot") broadcast(state);
  return state;
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
      if (existsSync(floatingPositionPath)) {
        try {
          const position = JSON.parse(readFileSync(floatingPositionPath, "utf8"));
          if (validCoordinate(position?.x) && validCoordinate(position?.y)) floatingPosition = { x: position.x, y: position.y };
        } catch (error) { console.error("Dock could not read the floating icon position:", error); }
      }
      localServices = new LocalServices(directory, database);
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
      ipcMain.handle("dock:capture-visibility", async (event, visible: unknown) => {
        const sender = [...windows.values()].find(window => window.webContents === event.sender);
        if (!sender || event.senderFrame !== sender.webContents.mainFrame)
          throw new Error("Unknown command sender.");
        if (typeof visible !== "boolean") throw new Error("Choose whether to show or hide quick capture.");
        if (visible) await openWindow("capture");
        else windows.get("capture")?.hide();
      });
      ipcMain.handle("dock:command", async (event, input: unknown) => {
        const sender = [...windows.values()].find(
          (window) => window.webContents === event.sender,
        );
        if (!sender || event.senderFrame !== sender.webContents.mainFrame)
          throw new Error("Unknown command sender.");
        return dispatch(parseCommand(input), sender);
      });
      ipcMain.on("dock:move-floating", (event, x: unknown, y: unknown) => {
        const window = windows.get("floating");
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
            !validCoordinate(x) || !validCoordinate(y) || process.platform !== "linux" && !window.isMovable()) return;
        const area = screen.getDisplayNearestPoint({ x, y }).workArea;
        const { width, height } = window.getBounds();
        window.setPosition(Math.max(area.x, Math.min(area.x + area.width - width, x)),
          Math.max(area.y, Math.min(area.y + area.height - height, y)));
      });
      stopLocalApi = await startLocalApi(directory, (command) =>
        dispatch(command),
      );
      const settings = database.settings();
      shortcutRegistered = globalShortcut.register(
        settings.shortcut,
        () => void openWindow("capture"),
      );
      const icon = nativeImage.createFromPath(
        join(__dirname, "../../resources/icon.png"),
      );
      try {
        tray = new Tray(icon.resize({ width: 22, height: 22 }));
        tray.setToolTip(`${appName} — tasks and notes`);
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: `Open ${appName}`, click: () => void openWindow("main") },
            { label: "Quick capture", click: () => void openWindow("capture") },
            { label: "Mini window", click: () => void openWindow("mini") },
            { label: "Floating icon", click: () => void openWindow("floating") },
            { type: "separator" },
            { label: "Quit Dock", click: () => app.quit() },
          ]),
        );
        tray.on("click", () => void openWindow("main"));
      } catch (error) {
        console.error("Dock tray unavailable:", error);
      }
      await openWindow("main");
      if (settings.floatingAtStartup) await openWindow("floating");
      if (settings.openMiniAtStartup) await openWindow("mini");
      screen.on("display-removed", () => { const floating = windows.get("floating"); if (floating) fitFloating(floating); });
      screen.on("display-metrics-changed", () => { const floating = windows.get("floating"); if (floating) fitFloating(floating); });
      updates.configure(settings.automaticUpdates);
      reminderTimer = setInterval(() => void tick(), 15_000);
      powerMonitor.on("resume", () => void tick());
      void tick();
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
    if (!quitting) {
      event.preventDefault();
      if (preparingQuit) return;
      preparingQuit = true;
      void Promise.all([...windows.values()].filter(window => !window.webContents.isLoadingMainFrame())
        .map(window => window.webContents.executeJavaScript("window.dock?.prepareUpdate(true)")))
        .then(() => { quitting = true; app.quit(); })
        .catch(error => {
          preparingQuit = false;
          void dialog.showMessageBox({ type: "warning", message: "Dock is still open", detail: error instanceof Error ? error.message : String(error) });
        });
      return;
    }
    if (floatingPositionTimer) saveFloatingPosition();
    for (const notification of activeNotifications) notification.close();
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
