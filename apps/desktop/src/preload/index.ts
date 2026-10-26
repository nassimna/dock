import { contextBridge, ipcRenderer } from "electron";
import {
  parseCommand,
  snapshotSchema,
  type DesktopBridge,
} from "@dock/contracts";

const beforeUpdate = new Map<() => Promise<void>, boolean>();
const bridge: DesktopBridge = {
  async setCaptureVisible(visible) {
    await ipcRenderer.invoke("dock:capture-visibility", visible);
  },
  moveFloating(x, y) {
    ipcRenderer.send("dock:move-floating", Math.round(x), Math.round(y));
  },
  onBeforeUpdate(listener, flushOnQuit = false) {
    beforeUpdate.set(listener, flushOnQuit);
    return () => { beforeUpdate.delete(listener); };
  },
  async prepareUpdate(quitting = false) {
    await Promise.all([...beforeUpdate].filter(([, flushOnQuit]) => !quitting || flushOnQuit).map(([listener]) => listener()));
  },
  async dispatch(command) {
    return snapshotSchema.parse(
      await ipcRenderer.invoke("dock:command", parseCommand(command)),
    );
  },
  onChanged(listener) {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) =>
      listener(snapshotSchema.parse(state));
    ipcRenderer.on("dock:changed", handler);
    return () => {
      ipcRenderer.removeListener("dock:changed", handler);
    };
  },
  onNavigate(listener) {
    const handler = (_event: Electron.IpcRendererEvent, view: unknown) => {
      if (view === "today" || view === "all" || view === "starred" || view === "settings") listener(view);
    };
    ipcRenderer.on("dock:navigate", handler);
    return () => { ipcRenderer.removeListener("dock:navigate", handler); };
  },
  onOpenTask(listener) {
    const handler = (_event: Electron.IpcRendererEvent, id: unknown) => { if (typeof id === "string") listener(id); };
    ipcRenderer.on("dock:open-task", handler);
    return () => { ipcRenderer.removeListener("dock:open-task", handler); };
  },
  onCapture(listener) {
    const handler = () => listener();
    ipcRenderer.on("dock:capture", handler);
    return () => {
      ipcRenderer.removeListener("dock:capture", handler);
    };
  },
};
contextBridge.exposeInMainWorld("dock", bridge);
