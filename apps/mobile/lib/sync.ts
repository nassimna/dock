import {
  DockSync,
  type SyncAuthCommand,
  type SyncFetch,
} from "@dock/core/sync";
import {
  syncCredentialsSchema,
  syncStatusSchema,
  syncFeaturesSchema,
  type SyncCredentials,
  type SyncStatus,
  type SyncFeatureCommand,
} from "@dock/contracts";
import * as SecureStore from "expo-secure-store";
import * as Device from "expo-device";
import { fetch } from "expo/fetch";
import { AppState } from "react-native";
import { getDatabase, notifyChanged } from "./database";

const SESSION_KEY = "dock.sync.session";
let engine: DockSync | undefined;
let credentials: SyncCredentials | null = null;
let initialization: Promise<void> | undefined;
let active = AppState.currentState === "active";
let recoveryCode = "";
let queue: Promise<unknown> = Promise.resolve();
const requests = new Set<AbortController>();

function serialize<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

const nativeFetch: SyncFetch = async (url, init) => {
  const controller = new AbortController();
  if (!active || init.signal.aborted) controller.abort();
  const abort = () => controller.abort();
  const finish = () => {
    requests.delete(controller);
    init.signal.removeEventListener("abort", abort);
  };
  const transportError = () => {
    const error = new Error(
      controller.signal.aborted
        ? "Sync request cancelled."
        : "Could not reach the sync server.",
    );
    error.name = controller.signal.aborted ? "AbortError" : "TypeError";
    return error;
  };
  init.signal.addEventListener("abort", abort);
  requests.add(controller);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      json: async () => {
        try {
          return await response.json();
        } catch (error) {
          if (error instanceof SyntaxError) throw error;
          throw transportError();
        } finally {
          finish();
        }
      },
    };
  } catch {
    finish();
    throw transportError();
  }
};

function createEngine() {
  return new DockSync(
    getDatabase(),
    notifyChanged,
    Device.modelName ?? "Rivnote Android",
    nativeFetch,
  );
}
async function stopEngine() {
  if (engine) {
    await engine.stop();
    engine = undefined;
  }
}
function resumeEngine() {
  if (active && credentials) {
    engine = createEngine();
    engine.restore(credentials);
  }
  notifyChanged();
}

export function initializeSync() {
  return (initialization ??= serialize(async () => {
    const saved = await SecureStore.getItemAsync(SESSION_KEY);
    if (saved) {
      try {
        const next = syncCredentialsSchema.parse(JSON.parse(saved));
        getDatabase().bindSyncAccount(next.endpoint, next.accountId);
        credentials = next;
      } catch {
        engine = createEngine();
        engine.restoreFailed();
        notifyChanged();
        return;
      }
    }
    resumeEngine();
  }).catch((error) => {
    initialization = undefined;
    throw error;
  }));
}

export function setSyncActive(next: boolean) {
  active = next;
  if (!active) for (const request of requests) request.abort();
  return serialize(async () => {
    await stopEngine();
    resumeEngine();
  });
}

async function persistSession(next: SyncCredentials) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  credentials = next;
}

export async function authenticate(command: SyncAuthCommand) {
  await initializeSync();
  return serialize(async () => {
    await stopEngine();
    try {
      const authentication = createEngine();
      const next = await authentication.authenticate(command);
      await persistSession(next);
      recoveryCode = authentication.statusFeatures().recoveryCode;
    } finally {
      resumeEngine();
    }
    if (active) await engine?.sync();
  });
}

export async function syncFeature(command: SyncFeatureCommand) {
  await initializeSync();
  return serialize(async () => {
    if (command.type === "sync.recover") {
      await stopEngine();
      try {
        const recovery = createEngine();
        const next = await recovery.feature(command);
        if (next) await persistSession(next);
        recoveryCode = recovery.statusFeatures().recoveryCode;
      } finally {
        resumeEngine();
      }
    } else {
      if (!engine || !credentials)
        throw new Error("Sign in before managing your account.");
      await engine.feature(command);
      if (command.type === "sync.recovery.create")
        recoveryCode = engine.statusFeatures().recoveryCode;
    }
    notifyChanged();
  });
}

export function disconnectSync() {
  for (const request of requests) request.abort();
  return serialize(async () => {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    credentials = null;
    recoveryCode = "";
    await engine?.disconnect();
    await stopEngine();
    notifyChanged();
  });
}

export function syncNow() {
  return serialize(async () => {
    if (active && credentials) await engine?.sync();
  });
}
export function localChanged() {
  engine?.localChanged(false);
}
export function syncStatus(): SyncStatus {
  return (
    engine?.status() ??
    syncStatusSchema.parse({
      connected: false,
      endpoint: getDatabase().syncAccount()?.endpoint ?? "",
      email: "",
      phase: "disconnected",
      pending: getDatabase().syncCounts().pending,
      conflicts: getDatabase().syncCounts().conflicts,
      lastSyncedAt: null,
      error: "",
    })
  );
}
export function syncFeatures() {
  return {
    ...(engine?.statusFeatures() ?? syncFeaturesSchema.parse({})),
    recoveryCode,
  };
}
