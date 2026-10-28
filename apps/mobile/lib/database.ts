import { DockDatabase, type SqliteConnection } from "@dock/core/database";
import { itemSchema, type StoreSnapshot } from "@dock/contracts";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import * as Crypto from "expo-crypto";
import { openDatabaseSync } from "expo-sqlite";
import { storage } from "./storage";

let database: DockDatabase | undefined;
const listeners = new Set<() => void>();

export function getDatabase(): DockDatabase {
  if (database) return database;
  const sqlite = openDatabaseSync("dock.sqlite");
  const connection: SqliteConnection = {
    exec: (sql) => sqlite.execSync(sql),
    prepare: (sql) => ({
      get: (...values) =>
        sqlite.getFirstSync<Record<string, unknown>>(sql, ...values) ??
        undefined,
      all: (...values) =>
        sqlite.getAllSync<Record<string, unknown>>(sql, ...values),
      run: (...values) => sqlite.runSync(sql, ...values),
    }),
    close: () => sqlite.closeSync(),
  };
  const next = new DockDatabase(connection, {
    randomUUID: Crypto.randomUUID,
    sha256: (value) => sha256(utf8ToBytes(value)),
  });
  try {
    if (
      !sqlite.getFirstSync(
        "SELECT 1 FROM settings WHERE key = 'mobile_mmkv_migrated'",
      )
    ) {
      const legacy = storage.getString("items.v1");
      if (legacy !== undefined)
        next.restoreBackup({
          items: itemSchema.array().parse(JSON.parse(legacy)),
        });
      sqlite.runSync(
        "INSERT INTO settings(key, value) VALUES('mobile_mmkv_migrated', '1')",
      );
    }
    database = next;
    return next;
  } catch (error) {
    next.close();
    throw error;
  }
}

export function notifyChanged() {
  for (const listener of listeners) listener();
}
export function subscribeChanged(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getSnapshot(): StoreSnapshot {
  return getDatabase().snapshot();
}
