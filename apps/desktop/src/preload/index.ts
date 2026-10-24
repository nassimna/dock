import { contextBridge, ipcRenderer } from "electron";
import {
  parseCommand,
  snapshotSchema,
  type DesktopBridge,
} from "@dock/contracts";

const beforeUpdate = new Set<() => Promise<void>>();
const bridge: DesktopBridge = {
  onBeforeUpdate(listener) {
    beforeUpdate.add(listener);
    return () => { beforeUpdate.delete(listener); };
  },
  async prepareUpdate() {
    await Promise.all([...beforeUpdate].map(listener => listener()));
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
  onCapture(listener) {
    const handler = () => listener();
    ipcRenderer.on("dock:capture", handler);
    return () => {
      ipcRenderer.removeListener("dock:capture", handler);
    };
  },
};
contextBridge.exposeInMainWorld("dock", bridge);
