import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { appBrand } from "@dock/contracts";
import { DockDatabase as CoreDockDatabase } from "@dock/core/database";

export class DockDatabase extends CoreDockDatabase {
  constructor(filename: string) {
    super(new DatabaseSync(filename), {
      randomUUID,
      sha256: value => createHash("sha256").update(value).digest(),
    });
  }
}

export function openLocalDatabase(directory: string): DockDatabase {
  const filename = join(directory, appBrand.databaseFilename);
  const previous = join(directory, "dock.sqlite");
  if (!existsSync(filename) && existsSync(previous)) {
    const legacy = new DatabaseSync(previous);
    try {
      // Fold crash-recovered WAL writes into the main file before moving it.
      const checkpoint = legacy.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      if (checkpoint?.busy !== 0)
        throw new Error("The local database is busy. Restart Rivnote to finish updating it.");
    } finally {
      legacy.close();
    }
    renameSync(previous, filename);
  }
  return new DockDatabase(filename);
}
